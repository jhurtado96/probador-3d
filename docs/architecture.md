# Arquitectura — Probador virtual 3D

Estado: propuesta para la fase 0, reconciliada con la investigación y con la primera tanda de implementación · 2026-11-11 · Contratos: `packages/contracts` (v0.3.0) · Decisiones que cambian lo escrito al principio: [§7 Registro de decisiones](#7-registro-de-decisiones)

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

Por qué R3F nativo y no WebView de entrada: la escena del MVP es ligera (un avatar de unos 20 000 triángulos y dos o tres prendas ya drapeadas en servidor, sin simulación en cliente), que es justo el caso en que `expo-gl` rinde bien, y la interacción (girar, hacer zoom, cambiar prenda) se integra mejor con gestos nativos. El riesgo real no es el rendimiento sino la carga de assets, y se neutraliza con el perfil de GLB de la sección 1.3.

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
├── package.json              # workspaces: ["apps/*", "packages/*"]; un único package-lock.json
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

Estado: el `package.json` raíz existe; todo lo JavaScript se instala desde la raíz (`npm install`) con un único `package-lock.json`, y `apps/app` depende de `@probador/contracts`. Las Edge Functions (Deno) no son un workspace: importan el contrato por ruta relativa desde `supabase/functions/deno.json`.

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

Funciones (rutas bajo `/functions/v1/`; así quedaron implementadas en `supabase/functions`):

| Función | Uso |
|---|---|
| `POST create-job` | Valida `CreateJobRequest`, comprueba consentimiento y cuota, inserta el job y responde `CreateJobResponse`: el `Job` y una URL firmada de subida por cada foto que falte. No hay `/uploads` aparte |
| `POST create-job/uploaded` | La app avisa de que subió las fotos y el job se despacha en el acto (si no avisa, `pg_cron` lo hace en menos de un minuto) |
| `POST job-callback` | Recibe `JobCallback` del worker (firma HMAC con marca de tiempo), borra las entradas y persiste resultados |
| `POST maintenance` | La llama `pg_cron`: despacho, borrado de fotos, barrido de 60 min y limpieza de ficheros huérfanos |
| `DELETE delete-account` | Borrado total |
| `GET export-data` | Exportación de datos (arts. 15 y 20 RGPD): `DataExport` en JSON con URLs firmadas de 1 h; 5 por usuario y día (§7, D7) |

Los consentimientos se registran y se retiran escribiendo en la tabla `consents` con RLS, sin función. Los errores de todas las funciones tienen la forma `ApiErrorBody` del contrato: `{ error: { code, message, details? } }`.

**Autenticación entre API y workers.** El despacho (API → worker) y el callback (worker → API) se firman igual, como especifica `packages/contracts`: cabeceras `x-probador-timestamp` (segundos Unix) y `x-probador-signature: sha256=<hex>`, con HMAC-SHA256 sobre `"<timestamp>." + cuerpo exacto`. Quien recibe rechaza firmas incorrectas y marcas de tiempo con más de 300 s de desfase, lo que acota los reenvíos; dentro de esa ventana ambas peticiones son idempotentes por `job_id` e `attempt`. Hay un secreto por sentido (`PROBADOR_DISPATCH_SECRET`, `PROBADOR_CALLBACK_SECRET`), con el mismo nombre en los dos lados, y un vector de prueba compartido que comprueban los tests de Node, Python y Deno.

### 3.2 Cola de trabajos GPU

**Decisión: la tabla `jobs` de Postgres es la fuente de verdad y la cola; la Edge Function despacha cada job por HTTP a Modal, el worker responde con un callback firmado, y `pg_cron` reintenta o da por fallidos los que se quedan colgados.**

- **Despacho**: `create-job` inserta la fila (`queued`) y, cuando las fotos están subidas, llama al endpoint de Modal con un `JobDispatch` firmado: el dueño (`user_id`), la entrada, URLs firmadas de descarga (15 minutos) y de subida (2 horas, límite fijo de Supabase; ver §7, D8), la URL de callback y, en el drapeado, el contexto que el simulador necesita.
- **Mínimo privilegio**: el worker no tiene la clave de servicio de Supabase ni acceso a la base de datos. Solo puede leer las entradas de su job y escribir sus salidas.
- **Progreso**: el worker envía callbacks `running` con `progress` y `stage`; la app los recibe por Supabase Realtime sobre su fila de `jobs`, con sondeo cada pocos segundos como respaldo.
- **Reintentos**: `pg_cron` cada minuto vuelve a despachar los `queued` sin arrancar y marca `failed` (`timeout`) los `running` que superan el plazo de su tipo. Máximo 3 intentos; el callback lleva `attempt` para descartar respuestas tardías de intentos anteriores.
- **Idempotencia**: el drapeado se deduplica por `cache_key`; el resto, por `job_id`.
- **Arranque en frío**: los modelos pesan gigas. Se guardan en un volumen del proveedor y se mide el arranque; si supera el objetivo, se mantiene un contenedor caliente en horario punta.
- **Cuotas**: límite de jobs por usuario y día en `create-job` (`quota_exceeded`), porque cada job cuesta dinero de GPU.
- **Modo fake**: un worker sin pipeline real puede devolver salidas de pega para integrar. Las marca con `fake: true` en el callback; la API las rechaza salvo permiso explícito de desarrollo y las anota en `jobs.fake`.

Proveedor: **Modal** como opción principal por su modelo de funciones Python con volúmenes y endpoints web, fijando región UE **(verificar disponibilidad, plan y sobrecoste de la selección de región)**. **RunPod** serverless en centro de datos UE es la alternativa. **Replicate** se descarta para todo lo que lleve fotos de personas mientras no garantice procesamiento en la UE **(verificar)**; sirve como mucho para prototipos con imágenes de prueba. Cuando el volumen lo justifique, la cola pasa a Supabase Queues (pgmq) sin cambiar el contrato.

### 3.3 Almacenamiento

**Decisión: Supabase Storage con dos buckets privados y URLs firmadas para todo — `raw-uploads`, efímero, para las fotos de entrada, y `assets`, con una carpeta por usuario, para todo lo que se conserva; Cloudflare R2 solo se añade para los GLB públicos de catálogo cuando el coste de salida lo pida.**

| Bucket y carpeta | Contenido | Acceso | Retención |
|---|---|---|---|
| `raw-uploads/<user_id>/` | Fotos de cuerpo, selfies, fotos originales de prendas | Subida: su dueño con URL firmada. Lectura: solo el worker con URL firmada | Se borran al terminar el job; barrido de seguridad a los 60 min |
| `assets/<user_id>/avatars/` | GLB del avatar | Su dueño (RLS por carpeta) | Hasta que el usuario lo borre |
| `assets/<user_id>/garments/<garment_id>/` | Recorte de la prenda, GLB en reposo y patrón de costura | Su dueño | Hasta el borrado |
| `assets/<user_id>/drapes/` | GLB de prenda drapeada sobre un avatar concreto | Su dueño | Caché: se purga a los 90 días sin uso o al cambiar el avatar |
| `assets/<user_id>/outfits/` | Miniaturas de outfits | Su dueño | Hasta el borrado |
| `assets/catalog/` | Prendas de catálogo de tienda | Lectura para cualquiera | Mientras el producto exista |

Un solo bucket con carpetas, y no un bucket por tipo como decía la primera versión, porque una única política por carpeta de usuario cubre todo y el borrado de cuenta es un solo listado.

Postgres guarda rutas de Storage, no URLs: cada campo `*_url` del contrato se guarda en una columna `*_path` y la app firma la ruta al mostrarla. En los callbacks y en `jobs.output` el mismo campo viaja como `storage://<ruta>`. El mapeo completo está documentado en la cabecera de `packages/contracts/src/index.ts` (`STORAGE_URL_COLUMNS`). Tablas: `profiles` (los «users» del plan), `consents`, `avatars`, `color_profiles`, `garments`, `garment_measurements`, `fit_results`, `user_fit_preferences`, `outfits`, `store_products`, `drape_cache`, `jobs` y `job_runs` (interna). Todas tienen tipo en el contrato salvo `job_runs`, y todas tienen RLS activado.

### 3.4 Flujo de un escaneo de punta a punta

**Decisión: la foto solo existe entre la subida y el callback del job, en un bucket efímero; lo único que se persiste es el avatar (parámetros, medidas y GLB).**

1. **Consentimiento**: la app muestra el consentimiento de escaneo corporal y lo inserta en `consents`; la fila da el `consent_id`.
2. **Captura**: captura guiada; la app reduce la foto a 2048 px y elimina EXIF.
3. **Job**: `POST create-job` con `{ type: "avatar", input: { photo_path, height_cm, consent_id } }`, donde `photo_path` es `raw-uploads/{user_id}/{nombre}.jpg`. La función valida, comprueba el consentimiento y la cuota, inserta el job y devuelve la URL firmada de subida.
4. **Subida**: la app sube la foto con esa URL y llama a `create-job/uploaded`; el job se despacha.
5. **Validación rápida** (CPU, pocos segundos): una persona, cuerpo entero, pose correcta. Si falla, el job termina `failed` con un código que la app traduce a una instrucción («separa los brazos del cuerpo»), y la foto se borra igualmente.
6. **Worker GPU**: estima el cuerpo con SAM 3D Body sobre el modelo MHR, ajusta la forma con la altura declarada como restricción y con la silueta, descarta la pose de la foto, calcula las medidas ISO 8559-1 sobre la malla en pose canónica, exporta el GLB en el perfil universal y lo sube con su URL firmada (`docs/research/avatar.md`). El avatar que devuelve lleva el GLB, las medidas con su incertidumbre, el nombre y la versión del modelo corporal y un vector de forma opaco: nada más del sistema depende de la topología.
7. **Callback**: `POST job-callback` con `AvatarJobOutput`. La función verifica la firma, valida contra el schema, **borra la foto de `raw-uploads`**, inserta en `avatars`, anota `jobs.input_deleted_at` y marca el job `succeeded`. El borrado y su constancia son de la API: el worker no puede borrar ni lo declara.
8. **App**: recibe el cambio por Realtime, descarga el GLB y lo muestra; el usuario puede corregir medidas (`measurements_override`).
9. **Red de seguridad**: `pg_cron` borra cualquier objeto de `raw-uploads` con más de 60 minutos, haya terminado el job o no. El worker no escribe la imagen en disco persistente ni en logs.

El flujo de **colorimetría** es el mismo con un selfie y una referencia de blanco (`type: "color"`): consentimiento propio, sale un `ColorProfile` y el selfie se borra en el callback. Las máscaras de piel, pelo e iris salen de los modelos de MediaPipe (Apache 2.0), no de pesos de face parsing entrenados con CelebAMask-HQ (§7, D2); el perfil lleva la confianza y los avisos de calidad de la captura (`docs/research/color.md`).

### 3.5 Flujo de una prenda

**Decisión: el mismo patrón de job, pero la prenda se crea al instante en estado `processing` para que el armario responda rápido, y de la foto original solo se conserva el recorte de la prenda.**

1. La app inserta la prenda (`status: "processing"`; en ese estado el contrato solo exige los campos que ya existen, `PendingGarment`).
2. `POST create-job` con `type: "garment"`; la app sube de 1 a 6 fotos con las URLs firmadas que recibe.
3. El worker segmenta la prenda (quita fondo y persona), extrae atributos y colores dominantes en LAB, estima `design_fit`, y representa la prenda como un **patrón de costura de GarmentCode**: en el nivel 1, una configuración cerrada por categoría con los parámetros ajustados a la silueta de la foto. Del patrón salen la malla en reposo, el mapa UV y las medidas en cm. Aplica la textura, exporta el GLB y calcula el embedding para recomendaciones (`docs/research/garment.md`).
4. El callback rellena `garments` y `garment_measurements`, guarda el recorte, el GLB y el patrón en `assets/<user_id>/garments/`, guarda el embedding en `garments.embedding`, borra las fotos originales y pasa la prenda a `ready` (`ReadyGarment`).
5. El usuario revisa y corrige el etiquetado; los campos corregidos se anotan en `user_corrected_fields` y un reprocesado no los pisa.

Los productos de tienda (fase 2) entran por la ingesta diaria y pasan por este mismo job con `user_id: null`; sus imágenes son de catálogo y no se borran.

### 3.6 Flujo de un drapeado

**Decisión: el drapeado se simula en servidor una vez por combinación y se guarda en caché; el cliente solo compone GLB ya drapeados sobre el avatar.**

1. El usuario pone una prenda en el outfit: `POST create-job` con `type: "drape"` (`avatar_id`, `garment_id`, `size_label`, `pose`, `quality`). La app solo envía identificadores.
2. La función calcula `cache_key = hash(shape_hash del avatar, prenda y su versión, talla, pose, calidad, tejido, versión del simulador)` y consulta `drape_cache`. **Si existe, responde `succeeded` al momento con `cache_hit: true`**, sin GPU.
3. Si no, la API añade al despacho el contexto que el simulador necesita (`DrapeJobDispatch.context`): GLB del avatar, patrón de costura y GLB de la prenda, medidas del cuerpo y de la prenda, tejido y la `cache_key`. El worker hace una **simulación física estática con Newton/Warp** (cosido de paneles y relajación hasta el equilibrio; `docs/research/drape.md`), exporta el GLB de la prenda en el sistema de coordenadas del avatar y calcula el `FitResult` (holgura por zona con su incertidumbre y veredicto). El cuerpo entra como malla de colisión, así que sirve cualquier modelo corporal.
4. El callback guarda el GLB en `assets/<user_id>/drapes/`, inserta en `drape_cache` y `fit_results`, y la app lo añade a la escena.

Para que la espera no rompa la experiencia: primero se pide `quality: "preview"` (simulación corta) y después `final` en segundo plano; mientras tanto se muestra la prenda en reposo. Al cambiar el avatar cambia `shape_hash` y sus drapeados se invalidan. Las capas (una prenda sobre otra) se dejan para la fase 3: en el MVP cada prenda se drapea sobre el cuerpo desnudo y el orden de capas es solo de dibujo, con el riesgo visible de que se atraviesen.

---

## 4. Privacidad por diseño (RGPD)

**Decisión: las fotos de cuerpo y cara se tratan como datos de máxima sensibilidad — consentimiento explícito y separado, procesamiento solo en la UE, vida máxima de una hora y ninguna copia fuera del bucket efímero — y lo único que se conserva son valores calculados, que siguen siendo datos personales y se borran con la cuenta.**

Esto es diseño técnico, no asesoramiento jurídico: antes de lanzar hace falta una evaluación de impacto (EIPD) y que un especialista confirme la base legal y si las medidas corporales o el perfil de color entran en categorías especiales.

### Dónde se borra cada foto

| Dato | Dónde vive | Cuándo se borra | Quién lo borra | Red de seguridad |
|---|---|---|---|---|
| Foto de cuerpo entero | `raw-uploads` | En el callback del job `avatar`, termine bien o mal | Edge Function `job-callback` | `pg_cron`: todo objeto con más de 60 min |
| Selfie de colorimetría | `raw-uploads` | En el callback del job `color` | Igual | Igual |
| Fotos originales de prenda | `raw-uploads` | En el callback del job `garment`; queda el recorte sin persona ni fondo | Igual | Igual |
| Copia en el worker | Memoria del contenedor | Al terminar la función | El propio worker; sin disco persistente, sin imágenes en logs ni trazas | Contenedores efímeros |
| Copia en el dispositivo | Caché temporal de la app | Tras confirmarse la subida | La app | No se guarda en la galería |

Cada borrado deja constancia en `jobs.input_deleted_at`, que escribe solo la API. Un test de extremo a extremo comprueba que `raw-uploads` queda vacío tras cada tipo de job, incluidos los fallidos y los que agotan el plazo.

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

Cada uno se guarda en `consents` con versión del texto, fecha y retirada; `create-job` rechaza el job (`consent_missing`) si no hay uno vigente. Retirar un consentimiento borra los datos derivados de él. Se exige edad mínima y no se procesan fotos de menores.

### Derechos del usuario

- **Borrado total** (`delete-account`): elimina filas en cascada, todos los objetos de Storage del usuario, las entradas de `drape_cache` y el usuario de Auth; las copias de seguridad caducan según la retención del proveedor, que se documenta. Excepción (§7, D6): antes de borrar cada consentimiento se copia a `consent_records_archive` un registro mínimo, seudonimizado (HMAC del `user_id` con un secreto de Vault) y bloqueado, que pg_cron borra a los 3 años.
- **Acceso y portabilidad**: `GET export-data` devuelve en JSON legible por máquina (tipo `DataExport` del contrato) todos los datos del usuario, con URLs firmadas de 1 hora a sus GLB y patrones (§7, D7).
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
| 5 | Licencias del modelo corporal y del estimador: SMPL-X no es comercial; la SAM License de SAM 3D Body no es una licencia abierta estándar | Bloqueo legal o coste | Decidido (§7, D1): MHR + SAM 3D Body, con el avatar independiente de la topología para poder cambiar de modelo sin tocar prenda, drapeado ni app. Revisión legal de la SAM License antes del MVP | MHR → Anny; plan B: API de medidas de terceros |
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
| Edge Functions como API | Latencia p95 de `create-job` y tasa de errores | Logs de Supabase | p95 < 500 ms, errores < 0,5 % | Mover esa ruta a un servicio propio |
| Cola en Postgres + Modal | Arranque en frío, espera en cola y duración por tipo de job | Marcas `created_at`, `started_at`, `finished_at` de `jobs` | Avatar ≤ 60 s p95, drapeado *preview* ≤ 20 s p95 | Contenedor caliente; después cambiar de proveedor |
| | Jobs colgados o duplicados | Consulta diaria sobre `jobs` | < 0,5 % | Pasar a pgmq |
| | Coste de GPU por job y por usuario activo | Facturación del proveedor / número de jobs | Dentro del coste objetivo por usuario (por fijar con negocio) | Cuotas, más caché, modelos más ligeros |
| Caché de drapeado | Tasa de aciertos | `cache_hit` en los jobs `drape` | ≥ 60 % pasado el primer mes | Precalcular prendas populares |
| Región UE | Ubicación real de cada proveedor y subencargado | Revisión documental antes del lanzamiento | Todo en la UE | Cambiar el proveedor que no cumpla |
| Borrado de fotos | Objetos en `raw-uploads` con más de 60 min | Consulta programada con alerta | Siempre 0 | Incidencia de privacidad: parar los escaneos hasta resolverla |
| Contratos generados | Callbacks rechazados por validación | Contador en `jobs/callback` | 0 en producción | Revisar el versionado del contrato |

### Orden propuesto para el spike de la fase 0

1. GLB de referencia en el perfil universal (avatar + 3 prendas) y su carga en los tres dispositivos y en web.
2. Si el paso 1 falla en nativo, repetir con el visor web embebido y comparar.
3. Un job `avatar` de punta a punta con un worker de pega en la región UE elegida, midiendo arranque en frío y comprobando el borrado de la foto.
4. Fijar versiones exactas de Expo, three y R3F con lo que haya funcionado, y dejar el test de carga de GLB como requisito para subirlas.

---

## 7. Registro de decisiones

**Decisión: lo que sigue prevalece sobre cualquier frase anterior de este documento, de los README o de la skill que diga otra cosa.** Cada entrada lleva fecha, decisión, motivo y alternativa descartada. Las cuatro primeras salen de la investigación de la fase 0 (`docs/research/`); D5 es la reconciliación entre contratos, backend y workers; D6 a D8 son decisiones legales y de producto tomadas por el usuario (D6 y D7, implementadas).

### D1 · Avatar independiente de la topología del modelo corporal · 2026-11-11

- **Decisión:** el contrato del avatar es GLB (malla y esqueleto) + medidas en cm con su incertidumbre + nombre y versión del modelo corporal + un vector de forma opaco (`Avatar.shape`). Ningún otro módulo (visor, prenda, drapeado, fit) lee la topología. En la fase 0 el cuerpo se estima con SAM 3D Body sobre MHR, con un ajuste de forma propio que impone la altura declarada, y las medidas se toman según ISO 8559-1 con un port de SMPL-Anthropometry (MIT). `body_model` admite `mhr`, `anny` y `smplx`; SOMA-X se evalúa como adaptador en el prototipo P1.
- **Motivo:** SMPL-X no permite uso comercial sin una licencia de pago cuyo precio y condiciones no se han podido confirmar, y todos los estimadores clásicos dependen de él. SAM 3D Body (SAM License) con MHR (Apache 2.0) es la única combinación verificada que admite uso comercial. Aislar la topología permite cambiar de modelo sin tocar el resto. Se ha revisado `docs/research/avatar.md` y no se ha encontrado un fallo que impida seguirlo.
- **Alternativa descartada:** SMPL-X como regla fija del proyecto, con Anny como única salida. Queda como formato opcional si algún día se firma la licencia.
- **Riesgos que quedan abiertos:** la SAM License no es una licencia abierta estándar y necesita revisión legal antes del MVP; ningún estimador publica error de medidas en cm, así que el objetivo de menos de 3 cm no está demostrado y puede exigir segunda foto o corrección manual; el plan B es una API de medidas de terceros.

### D2 · Face parsing con MediaPipe · 2026-11-11

- **Decisión:** las regiones de piel, pelo e iris del selfie se obtienen con MediaPipe Face Landmarker y el segmentador multiclase de MediaPipe.
- **Motivo:** ambos son Apache 2.0 y pueden ejecutarse en el dispositivo. Los pesos públicos de SegFormer y BiSeNet para face parsing están entrenados con CelebAMask-HQ, que no admite uso comercial.
- **Alternativa descartada:** SegFormer/BiSeNet con pesos públicos. Si MediaPipe se queda corto (barba, flequillo, velo), se entrena un modelo propio con datos de licencia limpia; las arquitecturas sí valen.

### D3 · Prendas como patrón de costura de GarmentCode · 2026-11-11

- **Decisión:** toda prenda de nivel 1 y 2 se representa como un patrón paramétrico de GarmentCode (MIT). El nivel 1 es un subconjunto cerrado de parámetros por categoría; el nivel 2, el mismo pipeline con más parámetros libres. El patrón se guarda junto al GLB (`Garment.sewing_pattern_url`) y es la entrada del drapeado.
- **Motivo:** del patrón salen la malla, el UV y las medidas de la prenda en cm, se regenera para cualquier talla, y los métodos de foto a patrón más viables predicen justo esos parámetros, así que no habrá migración al pasar al nivel 2.
- **Alternativa descartada:** plantillas de malla propias por categoría (habría que rehacerlas en el nivel 2) y el simulador que acompaña a GarmentCode (`NvidiaWarp-GarmentCode`), que es solo no comercial.

### D4 · Drapeado con simulación física sobre Newton/Warp · 2026-11-11

- **Decisión:** el drapeado es una simulación estática en servidor GPU con NVIDIA Warp / Newton (Apache 2.0), cacheada por combinación. El cuerpo entra como malla de colisión (el GLB del avatar) y la prenda como patrón. La API pasa al worker todo lo necesario en `DrapeJobDispatch.context`.
- **Motivo:** licencia limpia, generaliza a cualquier patrón y cuerpo sin entrenar, y basta el estado de equilibrio en una pose fija. La simulación da además la holgura por zona para el fit.
- **Alternativa descartada:** drapeado neuronal (HOOD, ContourCraft), que exige SMPL y cuyos pesos no tienen licencia declarada; queda como investigación para la fase 3. La caché compartida entre usuarios de cuerpo parecido que propone `drape.md` no se adopta todavía: hoy la caché es por usuario, y compartirla es una decisión de privacidad y de producto aún sin tomar.

### D5 · Reconciliación de contratos, backend y workers (contratos v0.2.0) · 2026-11-11

- **Decisión:** (a) despacho y callback se autentican con la misma firma HMAC-SHA256 con marca de tiempo y un secreto por sentido; (b) `input_deleted_at` y `fake` son campos del `Job` que escribe solo la API; (c) los `*_url` del contrato se guardan como `*_path` y viajan como `storage://<ruta>` en los callbacks; (d) `Garment` es una unión por estado; (e) un bucket `assets` con carpetas por usuario en lugar de un bucket por tipo; (f) los consentimientos se registran por RLS, sin función; (g) las migraciones se han editado en su sitio porque aún no se han aplicado a ningún proyecto en la nube.
- **Motivo:** cada parte había resuelto estos huecos por su cuenta y de forma distinta. La firma sin marca de tiempo permitía reenviar peticiones capturadas; el token Bearer y el HMAC eran dos mecanismos para lo mismo; el worker no puede borrar fotos, así que no debe declarar que se borraron.
- **Alternativa descartada:** token Bearer estático para el despacho; renombrar los `*_url` a `*_path` en el contrato (obligaba a cambiar también lo que emite el worker sin ganar nada); migraciones nuevas encima de un esquema que nadie ha desplegado.

### D6 · Consentimientos tras borrar la cuenta · 2026-11-11 · decisión del usuario

- **Decisión:** al borrar la cuenta los consentimientos no se borran en cascada. Se conserva un registro mínimo y seudonimizado — hash del `user_id`, tratamiento, versión del texto, fechas de concesión y de retirada, y nada más — en estado bloqueado (art. 32 LOPDGDD: solo accesible para atender a autoridades o reclamaciones) durante 3 años, el plazo de prescripción de las infracciones muy graves, y después se borra.
- **Motivo:** el art. 7.1 del RGPD obliga a poder demostrar que el usuario consintió, también después de que se haya ido.
- **Alternativa descartada:** borrar los consentimientos con el resto de la cuenta, que es lo que hace hoy `delete-account`.
- **Estado:** implementado (migración `20261111000700_consent_archive.sql`). Tabla `consent_records_archive` con hash HMAC-SHA256 del `user_id` (secreto `consent_pseudonym_secret` en Vault), tratamiento, versión del texto, fechas de concesión, retirada (o de la baja) y archivo; RLS sin políticas, solo lectura para service_role; la rellena un trigger antes de cualquier borrado de `consents` y pg_cron purga a los 3 años. Los consentimientos retirados en vida no se borran (siguen en `consents` como prueba) y se archivan con su fecha real de retirada al darse de baja. Se recomienda que un abogado revise el plazo y el bloqueo antes del lanzamiento.

### D7 · Exportación de datos · 2026-11-11 · decisión del usuario

- **Decisión:** un endpoint devuelve en JSON legible por máquina todos los datos del usuario (perfil, consentimientos, avatar con medidas, perfil de color, prendas con medidas, fit y outfits) y URLs firmadas temporales a sus GLB. La respuesta es inmediata o, como máximo, en menos de un mes. No incluye las fotos originales porque ya no existen.
- **Motivo:** derechos de acceso y de portabilidad (arts. 15 y 20 del RGPD).
- **Alternativa descartada:** atender las solicitudes a mano.
- **Estado:** implementado: Edge Function `GET export-data`, tipo `DataExport` en `packages/contracts` (v0.3.0), respuesta validada contra su JSON Schema, URLs firmadas de 1 hora (GLB, patrones, recortes y miniaturas), jobs sin salida ni rutas internas y cuota de 5 exportaciones por usuario y día. La respuesta es inmediata.

### D8 · URLs firmadas de subida de 2 horas · 2026-11-11 · decisión del usuario

- **Decisión:** se aceptan las 2 horas de caducidad que Supabase fija para las URLs firmadas de subida, en lugar de los 15 minutos previstos. Las de descarga siguen siendo de 15 minutos.
- **Motivo:** el plazo no es configurable en Supabase y el riesgo queda acotado por cuatro medidas: la ruta es única por job e intento; cada ruta admite una sola subida, sin sobrescribir; el callback solo acepta las rutas emitidas para el intento en curso; y en `raw-uploads` el job caduca y el barrido borra todo a los 60 minutos.
- **Alternativa descartada:** un proxy propio de subida con caducidad de 15 minutos, que añadiría un servicio por el que pasarían las fotos.
