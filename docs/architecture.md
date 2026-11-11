# Arquitectura — Probador virtual 3D

Estado: propuesta para la fase 0 · 2026-11-11 · Contratos: `packages/contracts` (v0.1.0)

**Recomendación en una frase:** una sola app Expo (expo-router) para web, Android e iOS, con la escena 3D escrita una vez en React Three Fiber y renderizada con WebGL en web y con `expo-gl` en nativo; Supabase en la UE como backend (Auth, Postgres con RLS, Storage, Edge Functions como API) y workers GPU en Python sobre Modal en región UE; todo el 3D en un único perfil de GLB que no necesita descodificadores WASM.

Lo marcado con **(verificar)** son hechos de librerías o proveedores que no se han comprobado en esta sesión y que el spike de la fase 0 debe confirmar antes de darlos por buenos.

---

## 1. Estrategia multiplataforma

### 1.1 Render 3D

**Decisión: la escena se escribe una vez en React Three Fiber y se monta con `@react-three/fiber` en web y `@react-three/fiber/native` + `expo-gl` en Android e iOS, detrás de un único componente `<Viewer3D>`; un visor web embebido (componente DOM de Expo / WebView) queda como plan B con la misma interfaz.**

`<Viewer3D>` es la frontera: recibe URLs de GLB (avatar y prendas drapeadas) y emite eventos (`onReady`, `onError`, `onSnapshot`). El resto de la app no importa `three`. Así cambiar de motor en nativo afecta a un fichero por plataforma y no a las pantallas.

| Opción | A favor | En contra | Papel |
|---|---|---|---|
| R3F nativo + `expo-gl` | Un solo código de escena; gestos y UI nativos por encima; sin puente de mensajes | Sin WASM ni Web Workers en Hermes, así que los descodificadores KTX2/Draco no funcionan tal cual; carga de texturas de GLB frágil; menos usado que la web | **Elegida** |
| Visor web en WebView (componente DOM `"use dom"` de Expo) | Mismo código que la web, con WASM y todos los loaders; comportamiento idéntico al navegador | Proceso aparte con límite de memoria propio (iOS mata el WebView si se pasa); gestos y estado por puente de mensajes; arranque más lento; calidad dispar del WebView de Android según el dispositivo | **Plan B**, tras la misma interfaz |
| WebGPU nativo (`react-native-wgpu` + renderer WebGPU de three) | Camino de futuro, mejor rendimiento | Más joven; en web exige WebGPU, aún no universal | Reevaluar en la fase 3 |
| Motor nativo (`react-native-filament`) | Mejor rendimiento y PBR en móvil | Segunda implementación de la escena: se pierde el código único con la web | Descartada salvo que fallen las dos primeras |
| Unity / Unreal embebido | Simulación de tela en cliente | Peso de la app, dos bases de código, web aparte | Descartada |

Por qué R3F nativo y no WebView de entrada: la escena del MVP es ligera (un avatar SMPL-X de unos 10 500 vértices y dos o tres prendas ya drapeadas en servidor, sin simulación en cliente), que es justo el caso en que `expo-gl` rinde bien, y la interacción (girar, hacer zoom, cambiar prenda) se integra mejor con gestos nativos. El riesgo real no es el rendimiento sino la carga de assets, y se neutraliza con el perfil de GLB de la sección 1.3.

### 1.2 Qué se comparte y qué no

**Decisión: se comparte todo salvo cuatro piezas con sufijo de plataforma (`.web.tsx` / `.native.tsx`): el lienzo 3D, la captura con cámara, el almacenamiento seguro de la sesión y la caché de ficheros GLB.**

| Compartido (un solo código) | Específico por plataforma |
|---|---|
| Rutas y pantallas (expo-router), estado, cliente Supabase, tipos de `@probador/contracts` | `Viewer3D.web.tsx` (`Canvas` de R3F DOM) y `Viewer3D.native.tsx` (`Canvas` de R3F nativo) |
| Grafo de escena R3F: luces, materiales, composición avatar + prendas, controles de órbita propios | `GuidedCapture.web.tsx` (`getUserMedia`) y `GuidedCapture.native.tsx` (cámara nativa) |
| Lógica de fit, ranking y colorimetría en cliente (solo lectura de resultados) | Sesión: `expo-secure-store` en nativo, cookie/almacenamiento del navegador en web |
| Subida de ficheros con URL firmada, seguimiento de jobs | Caché de GLB: `expo-file-system` en nativo, caché HTTP del navegador en web |

Consecuencias que hay que aceptar: `@react-three/drei` solo es fiable en web; en la escena compartida se usa únicamente lo que no toca el DOM, y los controles de cámara se escriben a mano con `react-native-gesture-handler`. Hace falta *development build* (EAS) desde el primer día: Expo Go no sirve en cuanto entren módulos nativos de cámara avanzada.

### 1.3 Limitaciones reales en iOS y Android

**Decisión: un único perfil de GLB «universal» para las tres plataformas — geometría cuantizada sin Draco, texturas JPEG/WebP embebidas de 1024 px (2048 px como máximo), sin KTX2 — con presupuestos por escena que el pipeline de exportación hace cumplir.**

| Tema | Situación en nativo | Qué hacemos |
|---|---|---|
| Draco | El descodificador es WASM/JS en worker; Hermes no tiene WebAssembly ni Web Workers **(verificar en la versión de Expo que se fije)** | No usar Draco. `KHR_mesh_quantization` reduce a la mitad sin descodificador |
| Meshopt | El descodificador habitual es WASM; existe uno de referencia en JS puro **(verificar)** | No en el MVP. Activarlo solo si las descargas lo piden y el spike confirma el descodificador JS |
| KTX2 / Basis | Transcodificador WASM en worker: no disponible con `expo-gl` | No en el MVP. Coste: las texturas ocupan en GPU su tamaño descomprimido (1024² RGBA ≈ 4 MB, 5,3 MB con mipmaps) |
| Texturas embebidas en GLB | `GLTFLoader` usa `Blob`/`ImageBitmap`, que React Native no implementa igual; R3F nativo lo parchea escribiendo a disco **(punto frágil conocido, verificar con cada subida de versión)** | Test de carga de GLB de referencia en CI de dispositivo; alternativa: texturas como ficheros aparte |
| Memoria | iOS cierra la app sin aviso al superar el límite; los Android de gama baja tienen 3–4 GB compartidos | Presupuesto por escena y liberación explícita (`dispose`) al cambiar de outfit |
| Rendimiento | Fluido con escenas pequeñas; cae con sombras dinámicas, posprocesado y muchas *draw calls* | Sin posprocesado; luz ambiental + una direccional, sombra de contacto falsa; `frameloop="demand"` para no gastar batería en reposo |
| Emuladores | `expo-gl` falla o va muy lento en algunos emuladores **(verificar)** | Probar siempre en dispositivo físico; matriz mínima abajo |
| Contexto GL | Se pierde al pasar la app a segundo plano | Reconstruir la escena desde la caché de GLB |

Presupuestos iniciales (a confirmar con medidas, sección 6):

| Recurso | Presupuesto |
|---|---|
| GLB de avatar | ≤ 2 MB, ≤ 25 000 triángulos, 1 textura de 1024 px |
| GLB de prenda drapeada | ≤ 3 MB, ≤ 40 000 triángulos, 1–2 texturas de 1024 px |
| Escena completa (avatar + 3 prendas) | ≤ 10 MB de descarga, ≤ 150 000 triángulos, ≤ 30 *draw calls*, ≤ 64 MB de texturas en GPU |
| Tiempo hasta ver el avatar | ≤ 3 s con wifi en un móvil de gama media |

Dispositivos de referencia: iPhone de hace 4–5 años (p. ej. iPhone 11/12), un Android de gama media actual y uno de gama baja con 4 GB. Las prendas con transparencias o doble cara son el caso que antes rompe el presupuesto: se prueban desde el spike.

### 1.4 Cámara y captura guiada

**Decisión: en el MVP la guía es una silueta superpuesta con comprobación de inclinación del móvil y la validación de la pose se hace en el servidor en pocos segundos; la detección de pose en tiempo real en el dispositivo llega después, primero en web.**

| | Web | Android | iOS |
|---|---|---|---|
| Vista previa y disparo | `getUserMedia` (exige HTTPS y gesto del usuario); alternativa siempre disponible: `<input type="file" capture>` o subir de la galería | `expo-camera` | `expo-camera` |
| Guía del MVP | Silueta + cuenta atrás | Silueta + nivel con `expo-sensors` + cuenta atrás | Igual que Android |
| Pose en tiempo real (fase posterior) | MediaPipe Tasks en el navegador (WASM, funciona hoy) | `react-native-vision-camera` con *frame processor* y MediaPipe/ML Kit nativo | Igual; además LiDAR/ARKit para medir (fase 3, solo modelos Pro) |
| Control de exposición y balance de blancos (colorimetría) | Casi inexistente, sobre todo en Safari | Limitado con `expo-camera`; completo con vision-camera | Igual que Android |
| Formato | JPEG del navegador | JPEG | Forzar JPEG sRGB: evitar HEIC y, si se puede, el procesado HDR |

Puntos que no se pueden pasar por alto:

- **Escritorio web**: una webcam no encuadra un cuerpo entero con comodidad. En escritorio se ofrece subir una foto o continuar en el móvil con un código QR.
- **Colorimetría**: los móviles aplican balance de blancos, HDR y suavizado de piel automáticos. Por eso el flujo exige una referencia de blanco en la imagen y la corrección se hace en el servidor; sin referencia, el perfil se entrega con confianza baja y `white_balanced: false`.
- **Validación rápida**: antes de lanzar el job GPU, un paso de CPU comprueba que hay una sola persona, de cuerpo entero y en la pose pedida, y devuelve un código de error concreto (`pose_invalid`, `body_not_fully_visible`…) para que el usuario repita la foto sin esperar.
- **Reescalado en cliente**: la foto se reduce a 2048 px de lado mayor y se le quitan los metadatos EXIF (incluida la ubicación) antes de subirla.

### 1.5 Alternativas y riesgos de la decisión

**Decisión: se sigue con R3F nativo salvo que el spike de una semana incumpla alguno de los umbrales de la sección 6; en ese caso se activa el plan B (visor web embebido) sin tocar las pantallas.**

- Si R3F nativo falla por carga de assets o por inestabilidad: pasar `Viewer3D.native.tsx` al componente DOM. Se gana KTX2/Meshopt y se pierde integración de gestos y margen de memoria.
- Si falla también el WebView en Android de gama baja: render en servidor de imágenes giratorias (8–16 vistas) como degradación para esos dispositivos.
- Si el producto acaba necesitando simulación de tela en cliente (no previsto): reabrir la opción de motor nativo.
- Riesgo de dependencia: R3F nativo y `expo-gl` tienen menos mantenimiento que sus equivalentes web, y el soporte nativo de R3F puede cambiar de paquete entre versiones mayores **(verificar al fijar versiones)**. Se fijan versiones exactas y se sube de SDK de Expo solo con el test de carga de GLB en verde.

---

## 2. Estructura del monorepo

**Decisión: npm workspaces para todo lo que es JavaScript/TypeScript (`apps/*`, `packages/*`) y proyectos Python independientes con `uv` en `services/`, unidos por los JSON Schemas de `packages/contracts`.**

```
probador-3d/
├── package.json              # workspaces: ["apps/*", "packages/*"]  (pendiente de crear)
├── apps/
│   └── app/                  # Expo: web, Android, iOS (expo-router)
├── packages/
│   └── contracts/            # tipos TS + JSON Schemas generados
├── supabase/
│   ├── migrations/           # SQL: tablas, RLS, pg_cron
│   └── functions/            # Edge Functions (Deno): la API
├── services/
│   ├── workers/              # Modal: avatar, color, garment, drape (Python, uv)
│   └── ingest/               # ingesta diaria de feeds de tiendas (fase 2)
└── docs/
```

Por qué así:

- **npm workspaces y no pnpm/Turborepo/Nx**: Expo detecta monorepos de npm sin configurar Metro a mano, hay un solo paquete compartido y ninguna necesidad de caché de builds todavía. pnpm añade fricción con Metro (enlaces simbólicos) a cambio de nada con este tamaño. Se revisa si pasan de cuatro o cinco paquetes.
- **`contracts` se consume como fuente TypeScript** (`main` apunta a `src/index.ts`): Metro lo transpila, no hay paso de build ni `dist` que se quede viejo.
- **La escena 3D vive dentro de `apps/app`** mientras haya una sola app. Se extrae a `packages/scene` solo si aparece un segundo consumidor (por ejemplo, el SDK para marcas de la fase 4).
- **Python fuera de los workspaces**: cada worker tiene dependencias de ML pesadas e incompatibles entre sí; cada uno es una imagen de contenedor propia. Validan entradas y salidas contra `packages/contracts/schemas/*.schema.json`, y pueden generar modelos Pydantic desde ahí.
- **Una sola fuente de verdad del contrato**: los schemas se generan desde los tipos (`npm run schemas`) y `npm test` falla si están desactualizados o si los ejemplos no validan.

Pendiente fuera de mi alcance: crear el `package.json` raíz con los workspaces; `packages/contracts` se ha instalado de forma aislada y su `package-lock.json` local sobra en cuanto exista el de la raíz.

---

## 3. Arquitectura de servicios

### 3.1 API

**Decisión: Supabase Edge Functions son la única API del MVP; no se despliega un FastAPI permanente. Python vive solo en los workers, y FastAPI entra en la fase 2 como servicio de ranking alojado en la misma plataforma que los workers, si hace falta.**

| Capa | Qué hace | Tecnología |
|---|---|---|
| Datos directos | Lecturas y escrituras simples del propio usuario (armario, outfits, preferencias, leer `jobs`) | Cliente Supabase desde la app, protegido por RLS |
| API con secretos | Crear jobs, firmar URLs de subida, despachar a GPU, recibir callbacks, borrar cuenta, registrar consentimientos | Edge Functions (Deno/TypeScript, importan `@probador/contracts`) |
| Cómputo pesado | Avatar, colorimetría, prenda, drapeado | Workers Python en Modal |
| Ranking y recomendaciones (fase 2) | Consultas pgvector + puntuación | Primero SQL/RPC; FastAPI solo si la lógica no cabe en SQL |

Por qué no FastAPI desde el principio: sería un segundo servicio que desplegar, vigilar y asegurar para hacer de pasarela, que es justo lo que las Edge Functions ya hacen pegadas a Auth y a la base de datos. Límite conocido: las Edge Functions tienen tiempo de ejecución y memoria acotados, así que nunca procesan imágenes; solo orquestan.

Endpoints mínimos:

| Función | Uso |
|---|---|
| `POST /uploads` | Devuelve una URL firmada de subida al bucket efímero |
| `POST /jobs` | Valida `CreateJobRequest`, comprueba consentimiento y cuota, inserta el job y lo despacha |
| `POST /jobs/callback` | Recibe `JobCallback` del worker (firma HMAC), persiste resultados y borra las entradas |
| `POST /consents` | Registra o retira un consentimiento |
| `DELETE /account` | Borrado total |

### 3.2 Cola de trabajos GPU

**Decisión: la tabla `jobs` de Postgres es la fuente de verdad y la cola; la Edge Function despacha cada job por HTTP a Modal, el worker responde con un callback firmado, y `pg_cron` reintenta o da por fallidos los que se quedan colgados.**

- **Despacho**: `POST /jobs` inserta la fila (`queued`) y llama al endpoint de Modal con un `JobDispatch`: la entrada, URLs firmadas de descarga y de subida con caducidad de 15 minutos, y la URL de callback.
- **Mínimo privilegio**: el worker no tiene la clave de servicio de Supabase ni acceso a la base de datos. Solo puede leer las entradas de su job y escribir sus salidas.
- **Progreso**: el worker envía callbacks `running` con `progress` y `stage`; la app los recibe por Supabase Realtime sobre su fila de `jobs`, con sondeo cada pocos segundos como respaldo.
- **Reintentos**: `pg_cron` cada minuto vuelve a despachar los `queued` sin arrancar y marca `failed` (`timeout`) los `running` que superan el plazo de su tipo. Máximo 3 intentos; el callback lleva `attempt` para descartar respuestas tardías de intentos anteriores.
- **Idempotencia**: el drapeado se deduplica por `cache_key`; el resto, por `job_id`.
- **Arranque en frío**: los modelos pesan gigas. Se guardan en un volumen del proveedor y se mide el arranque; si supera el objetivo, se mantiene un contenedor caliente en horario punta.
- **Cuotas**: límite de jobs por usuario y día en `POST /jobs`, porque cada job cuesta dinero de GPU.

Proveedor: **Modal** como opción principal por su modelo de funciones Python con volúmenes y endpoints web, fijando región UE **(verificar disponibilidad, plan y sobrecoste de la selección de región)**. **RunPod** serverless en centro de datos UE es la alternativa. **Replicate** se descarta para todo lo que lleve fotos de personas mientras no garantice procesamiento en la UE **(verificar)**; sirve como mucho para prototipos con imágenes de prueba. Cuando el volumen lo justifique, la cola pasa a Supabase Queues (pgmq) sin cambiar el contrato.

### 3.3 Almacenamiento

**Decisión: Supabase Storage con buckets privados y URLs firmadas para todo; las fotos de entrada van a un bucket efímero separado; Cloudflare R2 solo se añade para los GLB públicos de catálogo cuando el coste de salida lo pida.**

| Bucket | Contenido | Acceso | Retención |
|---|---|---|---|
| `raw-uploads` | Fotos de cuerpo, selfies, fotos originales de prendas | Subida: su dueño con URL firmada. Lectura: solo el worker con URL firmada | Se borran al terminar el job; barrido de seguridad a los 60 min |
| `avatars` | GLB del avatar | Su dueño (RLS por carpeta `user_id/`) | Hasta que el usuario lo borre |
| `garments` | Recorte de la prenda y GLB en reposo | Su dueño; catálogo de tienda: lectura para usuarios autenticados | Hasta el borrado |
| `drapes` | GLB de prenda drapeada sobre un avatar concreto | Su dueño | Caché: se purga a los 90 días sin uso o al cambiar el avatar |

Postgres guarda rutas de Storage, no URLs; la API o el cliente las firman al servir (los campos `*_url` de los contratos son esas URLs firmadas). Tablas: las del modelo de datos del plan (`users`, `avatars`, `color_profiles`, `garments`, `garment_measurements`, `fit_results`, `user_fit_preferences`, `outfits`, `store_products`, `drape_cache`, `jobs`) más `consents`. Todas con RLS activado y política por `user_id`.

### 3.4 Flujo de un escaneo de punta a punta

**Decisión: la foto solo existe entre la subida y el callback del job, en un bucket efímero; lo único que se persiste es el avatar (parámetros, medidas y GLB).**

1. **Consentimiento**: la app muestra el consentimiento de escaneo corporal; `POST /consents` devuelve `consent_id`.
2. **Captura**: captura guiada; la app reduce la foto a 2048 px y elimina EXIF.
3. **Subida**: `POST /uploads` → URL firmada → la app sube a `raw-uploads/{user_id}/{uuid}.jpg`.
4. **Job**: `POST /jobs` con `{ type: "avatar", input: { photo_path, height_cm, consent_id } }`. La función valida, comprueba el consentimiento y la cuota, inserta el job y lo despacha.
5. **Validación rápida** (CPU, pocos segundos): una persona, cuerpo entero, pose correcta. Si falla, el job termina `failed` con un código que la app traduce a una instrucción («separa los brazos del cuerpo»), y la foto se borra igualmente.
6. **Worker GPU**: estima SMPL-X, ajusta la escala con la altura, descarta la pose de la foto, calcula las medidas sobre la malla en pose canónica, exporta el GLB en el perfil universal y lo sube con su URL firmada.
7. **Callback**: `POST /jobs/callback` con `AvatarJobOutput`. La función verifica la firma, valida contra el schema, inserta en `avatars`, **borra la foto de `raw-uploads`**, anota `input_deleted_at` y marca el job `succeeded`.
8. **App**: recibe el cambio por Realtime, descarga el GLB y lo muestra; el usuario puede corregir medidas (`measurements_override`).
9. **Red de seguridad**: `pg_cron` borra cualquier objeto de `raw-uploads` con más de 60 minutos, haya terminado el job o no. El worker no escribe la imagen en disco persistente ni en logs.

El flujo de **colorimetría** es el mismo con un selfie y una referencia de blanco (`type: "color"`): consentimiento propio, sale un `ColorProfile` y el selfie se borra en el callback.

### 3.5 Flujo de una prenda

**Decisión: el mismo patrón de job, pero la prenda se crea al instante en estado `processing` para que el armario responda rápido, y de la foto original solo se conserva el recorte de la prenda.**

1. La app sube de 1 a 6 fotos a `raw-uploads` e inserta la prenda (`status: "processing"`).
2. `POST /jobs` con `type: "garment"`.
3. El worker segmenta la prenda (quita fondo y persona), extrae atributos y colores dominantes en LAB, estima `design_fit`, elige la plantilla paramétrica de la categoría (nivel 1), le aplica la textura y exporta el GLB en reposo. Calcula el embedding para recomendaciones.
4. El callback rellena `garments` y `garment_measurements`, guarda el recorte y el GLB en `garments/`, borra las fotos originales y pasa la prenda a `ready`.
5. El usuario revisa y corrige el etiquetado; los campos corregidos se anotan en `user_corrected_fields` y un reprocesado no los pisa.

Los productos de tienda (fase 2) entran por la ingesta diaria y pasan por este mismo job con `user_id: null`; sus imágenes son de catálogo y no se borran.

### 3.6 Flujo de un drapeado

**Decisión: el drapeado se simula en servidor una vez por combinación y se guarda en caché; el cliente solo compone GLB ya drapeados sobre el avatar.**

1. El usuario pone una prenda en el outfit: `POST /jobs` con `type: "drape"` (`avatar_id`, `garment_id`, `size_label`, `pose`, `quality`).
2. La función calcula `cache_key = hash(shape_hash del avatar, prenda y su versión, talla, pose, calidad, versión del simulador)` y consulta `drape_cache`. **Si existe, responde `succeeded` al momento con `cache_hit: true`**, sin GPU.
3. Si no, el worker simula la tela sobre el cuerpo, exporta el GLB de la prenda en el sistema de coordenadas del avatar y calcula el `FitResult` (holgura por zona y veredicto).
4. El callback guarda el GLB en `drapes/`, inserta en `drape_cache` y `fit_results`, y la app lo añade a la escena.

Para que la espera no rompa la experiencia: primero se pide `quality: "preview"` (simulación corta) y después `final` en segundo plano; mientras tanto se muestra la prenda en reposo. Al cambiar el avatar cambia `shape_hash` y sus drapeados se invalidan. Las capas (una prenda sobre otra) se dejan para la fase 3: en el MVP cada prenda se drapea sobre el cuerpo desnudo y el orden de capas es solo de dibujo, con el riesgo visible de que se atraviesen.

---

## 4. Privacidad por diseño (RGPD)

**Decisión: las fotos de cuerpo y cara se tratan como datos de máxima sensibilidad — consentimiento explícito y separado, procesamiento solo en la UE, vida máxima de una hora y ninguna copia fuera del bucket efímero — y lo único que se conserva son valores calculados, que siguen siendo datos personales y se borran con la cuenta.**

Esto es diseño técnico, no asesoramiento jurídico: antes de lanzar hace falta una evaluación de impacto (EIPD) y que un especialista confirme la base legal y si las medidas corporales o el perfil de color entran en categorías especiales.

### Dónde se borra cada foto

| Dato | Dónde vive | Cuándo se borra | Quién lo borra | Red de seguridad |
|---|---|---|---|---|
| Foto de cuerpo entero | `raw-uploads` | En el callback del job `avatar`, termine bien o mal | Edge Function `jobs/callback` | `pg_cron`: todo objeto con más de 60 min |
| Selfie de colorimetría | `raw-uploads` | En el callback del job `color` | Igual | Igual |
| Fotos originales de prenda | `raw-uploads` | En el callback del job `garment`; queda el recorte sin persona ni fondo | Igual | Igual |
| Copia en el worker | Memoria del contenedor | Al terminar la función | El propio worker; sin disco persistente, sin imágenes en logs ni trazas | Contenedores efímeros |
| Copia en el dispositivo | Caché temporal de la app | Tras confirmarse la subida | La app | No se guarda en la galería |

Cada borrado deja constancia (`input_deleted_at` en la salida del job). Un test de extremo a extremo comprueba que `raw-uploads` queda vacío tras cada tipo de job, incluidos los fallidos y los que agotan el plazo.

### Región, cifrado y accesos

- **Región UE**: proyecto Supabase en una región de la UE (Fráncfort o Irlanda) y workers GPU fijados a región UE. Ningún proveedor que procese fotos fuera de la UE. Contrato de encargo de tratamiento con cada proveedor y lista de subencargados.
- **Cifrado**: TLS en tránsito; cifrado en reposo del proveedor para base de datos y Storage. La sesión se guarda en el almacén seguro del sistema en nativo.
- **Acceso**: RLS en todas las tablas y buckets; URLs firmadas de vida corta; los workers no tienen credenciales de la base de datos; la clave de servicio solo existe en las Edge Functions.
- **Registros**: los logs llevan identificadores de job, nunca imágenes, medidas ni URLs firmadas.
- **Terceros**: ninguna foto se envía a APIs de modelos externas. Si el estilista con IA (fase 4) usa un modelo de terceros, recibe solo atributos de prendas, no fotos ni medidas identificables.

### Consentimientos

| Consentimiento | Cuándo se pide | Sin él |
|---|---|---|
| Escaneo corporal (foto → avatar y medidas) | Antes de la primera captura de cuerpo | Se pueden introducir las medidas a mano |
| Colorimetría (selfie → perfil de color) | Antes del selfie | Se puede elegir la estación a mano |
| Personalización y recomendaciones de tiendas | Al activar recomendaciones | La app funciona como armario |
| Analítica | En el primer arranque | Sin analítica |

Cada uno se guarda en `consents` con versión del texto, fecha y retirada; `POST /jobs` rechaza el job (`consent_missing`) si no hay uno vigente. Retirar un consentimiento borra los datos derivados de él. Se exige edad mínima y no se procesan fotos de menores.

### Derechos del usuario

- **Borrado total** (`DELETE /account`): elimina filas en cascada, todos los objetos de Storage del usuario, las entradas de `drape_cache` y el usuario de Auth; las copias de seguridad caducan según la retención del proveedor, que se documenta.
- **Acceso y portabilidad**: exportación en JSON de avatar, medidas, perfil de color, armario y outfits.
- **Rectificación**: medidas y estación de color editables a mano.
- **Minimización**: no se guarda textura de cara ni de piel en el avatar del MVP; el avatar se muestra con un material neutro. Si en el futuro se añade textura realista, es un consentimiento nuevo y otro apartado de la EIPD.

---

## 5. Riesgos de la arquitectura

**Decisión: los cinco primeros riesgos se resuelven con medidas en la fase 0, antes de construir el MVP sobre ellos.**

| # | Riesgo | Impacto | Mitigación | Decisión que revertiría |
|---|---|---|---|---|
| 1 | La carga de GLB con texturas falla o es inestable en R3F nativo | Sin 3D en móvil | Perfil universal sin descodificadores; test de carga en dispositivo; plan B tras `<Viewer3D>` | Render nativo → visor web embebido |
| 2 | Memoria o FPS insuficientes en Android de gama baja | Cierres, mala experiencia | Presupuestos por escena, `dispose`, render bajo demanda | Bajar texturas a 512 px o degradar a imágenes renderizadas en servidor |
| 3 | La GPU en región UE no está disponible o encarece demasiado | Bloquea el cumplimiento o el margen | Contrato `JobDispatch`/`JobCallback` independiente del proveedor | Modal → RunPod UE |
| 4 | Arranque en frío y duración del drapeado rompen la experiencia | Esperas de más de un minuto | Caché, vista previa + final, contenedor caliente en horas punta | Drapeado bajo demanda → precálculo de combinaciones frecuentes |
| 5 | Licencia comercial de SMPL-X: el GLB que llega al cliente deriva del modelo | Bloqueo legal o coste | El contrato ya admite `body_model: "anny"`; decidir antes del MVP | SMPL-X → alternativa abierta |
| 6 | Sin KTX2, las texturas pesan demasiado en GPU con outfits de varias prendas | Límite de prendas por outfit | Medir; tope de 1024 px; atlas por prenda | Perfil único → segundo perfil web con KTX2/Meshopt |
| 7 | Las Edge Functions se quedan cortas (tiempo, memoria, lógica de ranking) | API lenta o incompleta | Solo orquestan; ranking en SQL | Añadir FastAPI para ranking |
| 8 | La cola sobre tabla + `pg_cron` no aguanta picos | Jobs perdidos o duplicados | Idempotencia por `job_id` y `cache_key`, `attempt` en callbacks | Tabla → Supabase Queues (pgmq) |
| 9 | Deriva entre tipos TypeScript y validación en Python | Errores en producción entre servicios | Schemas generados, `npm test` en CI, validación en el callback | — |
| 10 | El color capturado no es fiable (HDR, balance de blancos automático, Safari) | Perfil de color erróneo | Referencia de blanco obligatoria para confianza alta; `white_balanced` y `confidence` visibles | Selfie libre → captura con vision-camera y exposición bloqueada |
| 11 | Coste de GPU por usuario mayor que el ingreso | Modelo de negocio | Cuotas, caché, medir coste por job desde el primer día | Limitar escaneos y drapeados en el plan gratuito |
| 12 | Una foto sobrevive al borrado (job colgado, error en el callback) | Incumplimiento del RGPD | Barrido a los 60 min y test de extremo a extremo | — |
| 13 | Subidas de versión de Expo o R3F rompen el visor nativo | Bloqueo de releases | Versiones exactas y test de carga de GLB antes de cada subida | — |

---

## 6. Qué medir para confirmar o revertir cada decisión

**Decisión: cada decisión tiene un umbral numérico; si no se cumple en el spike de la fase 0, se aplica la alternativa indicada.** Los umbrales son puntos de partida razonados, no datos medidos: se ajustan con los primeros resultados.

| Decisión | Qué medir | Cómo | Se mantiene si | Si no |
|---|---|---|---|---|
| R3F nativo + `expo-gl` | Carga correcta del GLB de referencia (avatar + 3 prendas con textura) | 20 cargas seguidas en los 3 dispositivos de referencia | 100 % sin fallos ni texturas negras | Visor web embebido |
| | FPS al girar la escena | Contador de fotogramas, 30 s | ≥ 50 FPS en gama media, ≥ 30 en gama baja | Reducir presupuestos; si no basta, plan B |
| | Memoria máxima de la app | Xcode Instruments / Android Studio Profiler, 10 cambios de outfit | < 400 MB y sin crecimiento sostenido | Corregir fugas; bajar texturas |
| | Tiempo hasta ver el avatar | Desde abrir la pantalla, wifi y 4G | ≤ 3 s wifi, ≤ 6 s 4G | Caché más agresiva; Meshopt |
| | Cierres del visor en producción | Monitor de errores por plataforma | < 0,5 % de sesiones con visor | Plan B en la plataforma afectada |
| Perfil de GLB universal | Tamaño de descarga y memoria de texturas por outfit | Informe del exportador en cada job | Dentro de los presupuestos de 1.3 | Segundo perfil con KTX2/Meshopt para web |
| Captura con silueta + validación en servidor | Porcentaje de fotos rechazadas e intentos hasta una válida | Códigos de error de los jobs | ≥ 80 % válidas al primer intento | Adelantar la pose en tiempo real |
| | Error de medidas frente a cinta métrica | Panel de prueba con cuerpos y tonos de piel variados | < 3 cm (métrica del plan) | Foto con objeto de referencia o segunda foto de perfil |
| Edge Functions como API | Latencia p95 de `POST /jobs` y tasa de errores | Logs de Supabase | p95 < 500 ms, errores < 0,5 % | Mover esa ruta a un servicio propio |
| Cola en Postgres + Modal | Arranque en frío, espera en cola y duración por tipo de job | Marcas `created_at`, `started_at`, `finished_at` de `jobs` | Avatar ≤ 60 s p95, drapeado *preview* ≤ 20 s p95 | Contenedor caliente; después cambiar de proveedor |
| | Jobs colgados o duplicados | Consulta diaria sobre `jobs` | < 0,5 % | Pasar a pgmq |
| | Coste de GPU por job y por usuario activo | Facturación del proveedor / número de jobs | Dentro del coste objetivo por usuario (por fijar con negocio) | Cuotas, más caché, modelos más ligeros |
| Caché de drapeado | Tasa de aciertos | `cache_hit` en los jobs `drape` | ≥ 60 % pasado el primer mes | Precalcular prendas populares |
| Región UE | Ubicación real de cada proveedor y subencargado | Revisión documental antes del lanzamiento | Todo en la UE | Cambiar el proveedor que no cumpla |
| Borrado de fotos | Objetos en `raw-uploads` con más de 60 min | Consulta programada con alerta | Siempre 0 | Incidencia de privacidad: parar los escaneos hasta resolverla |
| Contratos generados | Callbacks rechazados por validación | Contador en `jobs/callback` | 0 en producción | Revisar el versionado del contrato |

### Orden propuesto para el spike de la fase 0

1. GLB de referencia en el perfil universal (avatar SMPL-X + 3 prendas) y su carga en los tres dispositivos y en web.
2. Si el paso 1 falla en nativo, repetir con el visor web embebido y comparar.
3. Un job `avatar` de punta a punta con un worker de pega en la región UE elegida, midiendo arranque en frío y comprobando el borrado de la foto.
4. Fijar versiones exactas de Expo, three y R3F con lo que haya funcionado, y dejar el test de carga de GLB como requisito para subirlas.
