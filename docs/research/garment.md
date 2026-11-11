# Prenda 3D: foto de prenda → prenda 3D

Estado: diseño de fase 0 (2026-11-11). Verificación: **[V]** fuente primaria abierta, **[S]** solo resumen de buscador, **[M]** memoria, sin verificar.

## 1. Recomendación

Representar **todas** las prendas como un patrón de costura paramétrico de **GarmentCode** (MIT) y construir el nivel 1 como "modelo de visión → parámetros de un subconjunto cerrado de GarmentCode + textura", de modo que el nivel 2 sea el mismo pipeline con más parámetros libres y no una reescritura.

Motivos:

- GarmentCode (código MIT [V]) ya es una biblioteca de plantillas paramétricas: cada prenda es un conjunto de parámetros de diseño más las medidas del cuerpo, y genera paneles 2D, costuras y colocación 3D. Las "plantillas" del nivel 1 son simplemente configuraciones de diseño fijadas por categoría.
- Los métodos de nivel 2 más viables (ChatGarment, NGL-Prompter) predicen precisamente parámetros de GarmentCode. Empezar en esa representación evita migrar después.
- Los paneles dan gratis el mapa UV (el propio patrón) y las medidas de la prenda en cm (ancho de pecho, largo, manga), que es lo que necesita el módulo de fit.
- Un patrón se regenera para cualquier talla o cuerpo, lo que encaja con la caché de drapeado por avatar + prenda + talla.

Riesgo de licencia principal: el simulador que acompaña a GarmentCode (`NvidiaWarp-GarmentCode`) es un fork de Warp 1.0.0-beta.6 bajo **NVIDIA Source Code License, solo no comercial** [V]. Usar GarmentCode solo para patrón y malla, y simular con Warp/Newton oficiales (Apache 2.0); ver `drape.md`. Confirmar en el prototipo P2 que la generación de malla de `pygarment` funciona sin ese fork (la guía de instalación no lo aclara [V]).

## 2. Nivel 1: plantillas paramétricas + textura

Implementar cinco pasos; los cuatro primeros no necesitan entrenar nada.

### 2.1 Segmentación

Usar SAM 2 (código y pesos Apache 2.0 [V]) con una caja o punto inicial dado por el modelo de visión, y BiRefNet solo si su licencia de pesos se aclara.

- BiRefNet: código MIT, pero la licencia de los pesos no está declarada y se entrena con DIS5K, cuyos términos no figuran [V]. Su derivado RMBG-2.0 (BRIA) es solo no comercial [V]. Sirve para comparar calidad de bordes en P2, no para producción sin aclararlo.
- Casos: prenda extendida sobre fondo liso (caso guiado en la app), prenda en percha, prenda puesta. La fase 0 cubre solo extendida y en percha; la prenda puesta se deja para el nivel 2.
- Salida: máscara alfa, recorte y contorno. La app guía la captura: prenda extendida, fondo contrastado, vista cenital.

### 2.2 Clasificación de atributos

Usar un modelo de visión general con salida JSON estructurada validada contra un esquema (en `packages/contracts`), no un clasificador entrenado.

- Atributos: categoría (5–8 del MVP: camiseta, camisa, sudadera, jersey, pantalón, falda, vestido, chaqueta), largo, tipo y largo de manga, cuello, cierre, corte (ajustado, recto, oversize), tejido aparente (punto, plana, vaquero), color dominante, tipo de estampado (liso, repetido, posicional), confianza por atributo.
- Es lo mismo que hace NGL-Prompter (2026): estimación de patrón sin entrenamiento, preguntando a un modelo de visión por parámetros de GarmentCode [S].
- El usuario corrige los atributos en la interfaz ("etiquetado automático corregible"); las correcciones se guardan como datos de evaluación.
- Conjunto de evaluación: Fashionpedia (27 categorías, 294 atributos [V]; licencia de anotaciones CC BY 4.0 [M], verificar) y fotos propias. DeepFashion2 (13 categorías, 294 puntos clave) se distribuye con formulario y contraseña y sin licencia declarada en el repositorio [V]; se considera solo investigación [M] y no se usa para entrenar.

### 2.3 Ajuste de plantilla

Mapear atributos a parámetros de diseño con una tabla por categoría y refinar los parámetros continuos comparando la silueta de la plantilla con la máscara de la foto.

1. Tabla determinista atributos → parámetros de GarmentCode (por ejemplo: "manga corta" → longitud de manga 0,25; "oversize" → holgura de pecho +16 cm y hombro caído).
2. Refinado geométrico: renderizar la plantilla plana (unión de paneles frontales en disposición de prenda extendida), alinear con la máscara por similitud y optimizar 4–8 parámetros continuos (largo, ancho, largo de manga, ancho de bajo, profundidad de cuello) maximizando IoU. Sin gradientes: búsqueda por coordenadas o CMA-ES, menos de 2 s en CPU.
3. Escala real: la foto no tiene escala. Orden de preferencia: medidas de la tabla de la marca y talla de la etiqueta; objeto de referencia en la foto (tarjeta, A4); en su defecto, medidas típicas de la talla declarada. Sin escala fiable, la prenda se marca como "medidas estimadas" y el fit baja su confianza.
4. Salida: especificación del patrón (JSON/YAML de GarmentCode), medidas de prenda en cm y malla por paneles con UV.

### 2.4 Textura

Usar dos modos según el tipo de estampado: material repetible para lisos y repetidos, y proyección por registro de silueta para estampados posicionales.

- **Modo material** (liso, rayas, cuadros, estampado pequeño): extraer del interior de la máscara un parche sin pliegues ni sombras, corregir iluminación (dividir por la luminancia de baja frecuencia), hacerlo repetible y aplicarlo a todos los paneles respetando el hilo de cada panel. Color base en sRGB más un mapa de normales genérico por tipo de tejido. Es robusto y cubre la mayoría del armario.
- **Modo proyección** (logotipo, dibujo grande): deformar la foto frontal al espacio UV de los paneles frontales con una deformación por contorno (correspondencias entre el contorno de la máscara y el de la plantilla, interpolación thin-plate spline), y rellenar mangas, costados y espalda con el modo material. Espalda: segunda foto opcional.
- Quitar sombras y arrugas de la foto es el punto débil: probar descomposición intrínseca sencilla en P2 y, si no basta, dejar el relieve en el mapa de normales del tejido.
- Coordinar con `color.md`: el color dominante en CIELAB debe salir de la foto corregida con referencia de blanco, no de la textura final.

### 2.5 Exportación

Exportar GLB con la malla cosida en reposo, UV por panel, textura de 1–2 K y metadatos (patrón, medidas, tejido, capa) en `extras`; la versión drapeada la produce el módulo de drapeado.

## 3. Nivel 2: foto → patrón de costura

No adoptar todavía ningún modelo de nivel 2 en producción; prototipar la vía sin entrenamiento (modelo de visión → GarmentCode completo) y evaluar ChatGarment como referencia de calidad.

| Método | Qué hace | Código | Pesos y datos | Madurez |
|---|---|---|---|---|
| **GarmentCode** (ETH, 2023) + GarmentCodeData | DSL de patrones paramétricos; conjunto de 115 k prendas [M] | MIT [V] | Datos: CC BY-SA 4.0 según un agregador [S] o CC BY-NC [M]; **sin confirmar** (ETH bloqueado) | Alta como biblioteca; activo en 2025 [V]. Simulador asociado no comercial [V] |
| **ChatGarment** (MPI, CVPR 2025) | LLaVA ajustado: imagen o texto → JSON de GarmentCode | Apache 2.0 [V] | Licencia de pesos y del conjunto no declarada [V]; base LLaVA 1.5 [V]; usa GarmentCodeRC (MIT [V]) y ContourCraft-CG | Media: código de inferencia y entrenamiento públicos; GPU de 24 GB o más [M]; usa GPT-4o en algunos scripts [V] |
| **NGL-Prompter** (2026) | Sin entrenamiento: modelo de visión → parámetros de GarmentCode; multicapa | "Se publicará para investigación" [S] | — | Baja como software; la idea es replicable con nuestro propio modelo de visión |
| **Sewformer** (2023) + SewFactory | Transformer imagen → paneles y costuras | Sin fichero de licencia en el repositorio [V] = todos los derechos reservados | Pesos y datos en Hugging Face, licencia no verificada (host bloqueado) | Baja: simulación con Maya en Windows [V], prendas sintéticas, sin mantenimiento. **Descartado** |
| AIpparel (Stanford, 2025) | Modelo multimodal sobre patrones GarmentCode | Sin verificar [M] | Sin verificar [M] | Media [M] |
| DressWild, Image2Garment, GarmentWeaver (2026) | Patrones desde fotos reales | Sin código verificado [S] | — | Solo artículos |

Lectura: la investigación converge en "modelo de lenguaje y visión → GarmentCode". El riesgo no es el código sino los **pesos y datos** (licencias no declaradas o con cláusulas no comerciales o de copyleft). Vía limpia para fase 3: generar nuestro propio conjunto sintético con GarmentCode (MIT) + nuestro simulador y ajustar un modelo de visión con licencia comercial, o seguir sin entrenamiento con un modelo de visión general.

Nivel 3 (3D nativo de marca: CLO3D, Style3D, Browzwear): importar como GLB con medidas; fuera de la fase 0.

## 4. Métricas de la fase 0

Medir el nivel 1 con cuatro números sobre 60 prendas reales (ver `phase0-plan.md`): acierto de categoría y atributos, IoU de silueta plantilla–foto, error de medidas de prenda en cm frente a cinta, y nota visual ciega de 1 a 5.

## 5. Riesgos abiertos

- Simulador de GarmentCode no comercial y dependencia de `pygarment` con él, por confirmar.
- Licencia de GarmentCodeData, de los pesos de ChatGarment y de BiRefNet sin confirmar.
- Escala real de la prenda sin referencia: condiciona el fit más que el aspecto.
- Prendas fuera de plantilla (asimétricas, drapeadas, con capucha y bolsillos complejos): caer a la plantilla más cercana y marcar "aproximada".

## Fuentes

Abiertas [V]:
- https://github.com/maria-korosteleva/GarmentCode y `docs/Installation.md`
- https://github.com/maria-korosteleva/NvidiaWarp-GarmentCode
- https://github.com/biansy000/ChatGarment , https://github.com/biansy000/GarmentCodeRC
- https://github.com/sail-sg/sewformer
- https://github.com/facebookresearch/sam2 , https://github.com/ZhengPeng7/BiRefNet
- https://github.com/switchablenorms/DeepFashion2 , https://github.com/cvdfoundation/fashionpedia

Solo vistas en resultados de búsqueda [S]:
- https://arxiv.org/abs/2412.17811 (ChatGarment)
- https://arxiv.org/abs/2602.20700 (NGL-Prompter)
- https://arxiv.org/abs/2405.17609 (GarmentCodeData) y https://www.research-collection.ethz.ch/entities/researchdata/d9df8fe3-2add-49a2-bb58-21750ca7970c
- https://arxiv.org/abs/2608.30550 (GarmentWeaver), DressWild (arXiv 2602.16502)

No accesibles desde esta sesión: huggingface.co, arxiv.org, www.research-collection.ethz.ch.
