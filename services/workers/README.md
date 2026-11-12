# probador-workers

Workers GPU (`avatar`, `garment`, `drape`, `color`) en Python 3.11+ con uv. **Solo `avatar` tiene pipeline real** (fase 0,
prototipo P1a; ver «Avatar»). Sin `--fake`, `garment`, `drape` y `color` terminan con un callback `failed`
(`code: not_implemented`, `retryable: false`).

Contrato: `packages/contracts/schemas/*.schema.json` (se leen desde esa ruta relativa; no se copian). El worker recibe un
`JobDispatchNotice` firmado con solo `job_id`, tipo, intento y `dispatch_url`; ya en el contenedor pide el `JobDispatch`
completo a `dispatch_url` (Edge Function `job-dispatch`) con una petición `JobDispatchFetch` firmada con
`PROBADOR_CALLBACK_SECRET`. El `JobDispatch` lleva URLs firmadas (nunca credenciales de base de datos); el worker descarga
la entrada, sube el GLB y responde con un `JobCallback` firmado. La API entrega cada despacho una sola vez por intento: un
aviso reenviado recibe 409 y no vuelve a descargar la foto (revisión de la fase 0, A3 y B4). Dispatch y callback se autentican igual (contrato, «Firma de peticiones entre API y
workers»): `x-probador-timestamp: <segundos Unix>` y `x-probador-signature: sha256=<hex>`, HMAC-SHA256 sobre
`"<timestamp>." + bytes exactos del cuerpo`; se rechaza con más de 300 s de desfase (reenvíos). Un secreto por sentido,
con el mismo nombre en la API y en el worker. El vector `packages/contracts/fixtures/signature-vector.json` se prueba aquí.

Del dispatch salen también el dueño (`user_id`, que el worker copia en las entidades de salida) y, en el drapeado,
`context`: GLB del avatar, patrón GarmentCode y GLB de la prenda (sus URLs están en `input_urls`), medidas, tejido y la
`cache_key` que hay que devolver. El worker no borra fotos ni declara `input_deleted_at`: eso es de la API.

## Estructura

```
src/probador_workers/
  schemas.py      validación de JobDispatch / JobCallback (+ entrada/salida por tipo)
  signing.py      firma y verificación HMAC
  http_client.py  descarga/subida con URLs firmadas, callback firmado con reintentos
  handlers/       un manejador por tipo (interfaz común JobHandler: run_real / run_fake)
  runner.py       dispatch -> handler -> callback
  server.py       servidor FastAPI local (equivale al endpoint de Modal)
  logging_setup.py  JSON estructurado sin URLs ni datos personales
  fake_data.py    artefactos y salidas FALSAS (--fake)
  avatar/         pipeline real del avatar: validate (foto), pipeline (SAM 3D Body + MHR, GPU), measure (medidas),
                  geometry, glb (exportación), output (AvatarJobOutput), deploy (imagen y versiones de Modal)
modal_app.py      entrada Modal (región UE y GPU por tipo configurables)
modal_avatar_weights.py  descarga única de los pesos de SAM 3D Body (único uso del Modal Secret `huggingface`)
modal_avatar_tools.py    pruebas del avatar en Modal sin Supabase (assets públicos, MHR, foto pública)
```

## Local

```bash
cd services/workers
uv sync                       # (o: python -m venv .venv && pip install -e . pytest)
uv run pytest

# servidor local; --fake genera salidas válidas marcadas como falsas
PROBADOR_CALLBACK_SECRET=dev PROBADOR_DISPATCH_SECRET=dev uv run probador-workers serve --fake

# un job suelto sin red: imprime los callbacks en vez de enviarlos
uv run probador-workers run dispatch.json --fake --dry-run
```

`POST /dispatch` (cuerpo = JobDispatchNotice JSON; cabeceras de firma calculadas con `PROBADOR_DISPATCH_SECRET`)
responde 202 y en segundo plano pide el JobDispatch a `dispatch_url` y lo procesa; el resultado llega al `callback_url`
del dispatch. `run dispatch.json` sigue aceptando un JobDispatch completo para pruebas locales.

## Modo fake

`--fake` o `PROBADOR_FAKE=1`. No descarga fotos. Las salidas cumplen el esquema pero están marcadas: todos los callbacks
llevan `fake: true` (marca estándar del contrato; la API la copia a `jobs.fake` y la rechaza si no tiene
`PROBADOR_ALLOW_FAKE_WORKERS=1`), `worker_version` `<tipo>-fake-<ver>`, `model_version`/`pipeline_version` `fake/...`,
`confidence: 0`, medidas a 0 con `measurements_source: "unmeasured"`, nombre `FAKE`, GLB de un triángulo y patrón vacío
con `generator: "probador-workers FAKE"`, sin embedding. **Se rechaza con `PROBADOR_ENV=production`.**

## Modal

```bash
uv sync --extra modal
modal secret create probador-workers PROBADOR_DISPATCH_SECRET=... PROBADOR_CALLBACK_SECRET=...
PROBADOR_ENV=production PROBADOR_MODAL_REGION=eu modal deploy modal_app.py
```

`dispatch` (CPU, región UE) valida la firma y el JobDispatchNotice, hace `.spawn()` a `run_<tipo>` (GPU por tipo, región
UE) y devuelve 202.

**Qué guarda Modal (A3).** Modal conserva en su plano de control la entrada de cada llamada lanzada con `.spawn()` y su
valor de retorno. Por eso a la cola solo entra el aviso (ids, sin `user_id`, medidas ni URLs firmadas) y `run_<tipo>`
devuelve `None`: el `JobDispatch` viaja por HTTPS directo de la API al contenedor y el resultado, por el callback. El
timeout de cada función es el plazo del intento en la API (`JOB_TIMEOUT_S`: 10 min; 5 min color, B4). Quedan los logs
de Modal, que no llevan URLs ni datos personales (ver «Privacidad»). **Pendiente del usuario:** firmar el contrato de
encargo de tratamiento (DPA) con Modal y confirmar por escrito dónde residen su plano de control, la cola de entradas,
los resultados y los logs, y durante cuánto tiempo; si no es la UE, pasar a RunPod UE (docs/architecture.md §7, D11). (verificar) nombre exacto de la región UE, disponibilidad de GPU y sobrecoste de fijar región en el plan de Modal.
Los esquemas se montan en la imagen desde `packages/contracts/schemas`: despliega desde el monorepo completo.

## Variables de entorno (ningún valor por defecto es secreto)

| Variable | Uso | Por defecto |
|---|---|---|
| `PROBADOR_ENV` | `development` / `production` (en producción: exige ambos secretos, prohíbe fake y http) | `development` |
| `PROBADOR_FAKE` | salidas falsas | `0` |
| `PROBADOR_DISPATCH_SECRET` | secreto HMAC para autenticar el dispatch entrante (Modal Secret); mismo nombre y valor en las Edge Functions | sin definir |
| `PROBADOR_CALLBACK_SECRET` | secreto HMAC con el que se firma el callback (Modal Secret); mismo nombre y valor en las Edge Functions | sin definir |
| `PROBADOR_SCHEMAS_DIR` | carpeta de schemas | `../../packages/contracts/schemas` |
| `PROBADOR_ALLOWED_URL_HOSTS` | lista de hosts (o sufijos) permitidos para URLs firmadas, `dispatch_url` y callback, separados por comas. **Obligatoria en producción** (el host del proyecto de Supabase). Siempre se rechazan IP literales, `localhost`, `*.local` e `*.internal` salvo en desarrollo (B3) | cualquiera (solo https) en desarrollo |
| `PROBADOR_ALLOW_INSECURE_LOCALHOST` | permite `http://localhost` | `1` salvo producción |
| `PROBADOR_MODAL_REGION` | región Modal (solo en despliegue): `eu` = cualquier país del EEE (1,15x); `eu-west`/`eu-north`/`eu-south` fijan zona (1,75x) | `eu` |
| `PROBADOR_GPU_AVATAR` / `_GARMENT` / `_DRAPE` / `_COLOR` | GPU por tipo (`none` = CPU; varias separadas por comas = alternativas por capacidad); valores iniciales sin medir salvo el avatar | `L4,A10G` / `T4` / `A10G` / `T4` |
| `PROBADOR_AVATAR_WEIGHT_FIT` | ajustar la forma al peso declarado (`0` lo desactiva) | `1` |
| `PROBADOR_AVATAR_EXPORT_LOD` | LOD de MHR del GLB (1: 36.874 triángulos; 2: 21.318) | `2` |
| `PROBADOR_MAX_DOWNLOAD_BYTES`, `PROBADOR_MAX_UPLOAD_BYTES`, `PROBADOR_HTTP_TIMEOUT_S` | límites | 25 MB, 64 MB, 30 s |

## Avatar (pipeline real, fase 0)

`run_real` del job `avatar` (docs/research/avatar.md):

1. Carga los modelos (una vez por contenedor) **antes** de descargar la foto: si faltan los pesos, falla con `internal`
   sin tocarla.
2. Descarga la foto con la URL firmada a memoria; nunca a disco ni a los logs. Se decodifica (JPEG/PNG/WebP, orientación
   EXIF, lado mayor ≤ 2048 px) y el array se pone a cero y se suelta en cuanto SAM 3D Body ha estimado la forma.
3. Valida con Keypoint R-CNN (torchvision): una sola persona (`no_person_detected`, `multiple_people`), cuerpo entero con
   cabeza y tobillos dentro (`body_not_fully_visible`), tamaño suficiente (`low_image_quality`) y de pie con las piernas
   extendidas (`pose_invalid`). Formato ilegible: `invalid_input`. Ninguno se reintenta.
4. SAM 3D Body (variante ViT-H, solo decodificador de cuerpo) con la caja de la persona -> 45 coeficientes de identidad
   y 28 de escala de MHR. La pose de la foto se descarta.
5. MHR en pose cero (pose A canónica de MHR: brazos a unos 45°), con el modelo TorchScript del checkpoint. Si viene el
   peso, se ajustan los 20 coeficientes de cuerpo para que densidad (985 kg/m³) × volumen a la altura declarada se
   acerque al peso, con un prior que penaliza alejarse de la estimación (60 iteraciones de Adam, ~3 s).
6. Orientación a +Z, pies en y = 0 y escala uniforme a la altura declarada (las proporciones salen del estimador; el
   ajuste por silueta es P1b).
7. Medidas en cm sobre la malla LOD 1 con `avatar/measure.py` (cortes planos y envolvente convexa, independiente de la
   topología; puntos de referencia MHR70 del mapeo de keypoints de SAM 3D Body). `measurements_sigma_cm` parte de
   `BASE_SIGMA_CM` (perímetros 5–6 cm, longitudes 2,5–3 cm; ×0,85 si el ajuste al peso converge) y `confidence` tiene
   techo 0,5 mientras no haya validación con voluntarios (P1c). Ver `avatar/output.py`.
8. GLB 2.0 en LOD 2 (21.318 triángulos, ~0,7 MB): metros, Y arriba, mirando a +Z, pies en el origen, normales, material
   neutro y esqueleto de MHR (127 articulaciones, 4 influencias por vértice). Se sube a la URL firmada `glb`.
9. Devuelve `AvatarJobOutput` con `body_model: "mhr"`, `pose: "a_pose"`, `measurements_source: "photo"` y
   `model_version` = `mhr-lod1/sam-3d-body-vith@<revisión HF>/code@<commit>/avatar-p0.1`. `shape.params` es opaco:
   45 de identidad + 28 de escala de MHR + el factor de escala global (74 números).

Los logs del job solo llevan tiempos, tamaños y nº de vértices; nunca medidas, foto ni URLs.

**GPU: L4 (24 GB), con A10G de reserva.** SAM 3D Body ViT-H y MHR caben de sobra en 24 GB y el trabajo es pequeño
(una imagen de 256×192 por el ViT y una malla de 18 k vértices), así que la diferencia de cómputo entre L4 y A10G pesa
poco frente al arranque en frío; L4 es ~25 % más barata por segundo en Modal. En la región `eu` no siempre hay L4
libre: con `L4,A10G` Modal usa la primera que tenga capacidad.

**Versiones fijadas** (`avatar/deploy.py`): sam-3d-body `b5c765a`, MHR `85fc2cb` (topología LOD 2 y mapeo
LOD 1→2) y assets públicos de MHR v1.0.1 (sha256 comprobado), torch 2.7.1 / torchvision 0.22.1 y el resto de paquetes con
versión exacta. La revisión de los pesos de Hugging Face se fija al descargarlos y queda en `manifest.json` del volumen
y en `model_version`.

**Pesos** en el `modal.Volume` `probador-avatar-weights` (`/weights`): `sam-3d-body-vith/` (model.ckpt,
model_config.yaml, assets/mhr_model.pt), `torch/` (Keypoint R-CNN), `mhr-v1.0.1/` (solo pruebas) y `manifest.json`.
Los workers trabajan con `HF_HUB_OFFLINE=1`.

### Puesta en marcha (una vez)

1. Cuenta en Hugging Face. Abrir https://huggingface.co/facebook/sam-3d-body-vith, aceptar la licencia (SAM License) y
   esperar a que Meta apruebe el acceso (lo indica la propia página y llega un email).
2. Crear un token de **lectura** en https://huggingface.co/settings/tokens (tipo *Read*, o *fine-grained* con solo
   lectura de repositorios públicos con acceso restringido).
3. En Modal (https://modal.com/secrets, entorno `main`): *Create new secret* -> *Custom* -> nombre `huggingface`, clave
   `HF_TOKEN`, valor el token. O con la CLI: `modal secret create huggingface HF_TOKEN=hf_...`.
4. En GitHub, Actions -> «Avatar en Modal» -> *Run workflow* con la tarea `all`: comprueba el secreto, baja los pesos al
   volumen (`assets` y `weights`), prueba MHR (`probe`) y ejecuta la prueba real con una foto pública (`smoke`).

El token solo lo lee `modal_avatar_weights.py` (app aparte `probador-avatar-weights`). Si el secreto no existe, falla solo
esa tarea; el despliegue de `probador-workers` no lo referencia.

### Pruebas en Modal sin Supabase

`modal_avatar_tools.py` (workflow «Avatar en Modal»): `fetch_public_assets`, `probe_mhr` (MHR público en pose canónica:
medidas, ajuste al peso y GLB, sin SAM 3D Body) y `smoke_avatar` (busca en Wikimedia Commons fotos de cuerpo entero con
licencia CC0 o de dominio público, comprobada con la API de Commons, las descarga dentro de Modal, ejecuta el pipeline
dos veces —en frío y en caliente— y escribe solo métricas; con `image_url` se usa esa foto). Sin los pesos de SAM 3D Body,
`smoke_avatar` se limita a descargar y validar las fotos.

## Privacidad

**Fotos de prenda (M5, docs/architecture.md §7, D12).** El pipeline real de `garment` tiene que detectar personas (piel o
cara, con MediaPipe) en cada foto y, si aparece una, fallar con `person_detected` sin subir ningún recorte. Es un requisito
para activar el pipeline real; el esqueleto actual no procesa fotos (`not_implemented`).

Los logs son JSON con `job_id`, tipo, intento, etapa y duración. Se descartan campos con nombre sensible, se sustituye
cualquier URL o `storage://` en los valores, las excepciones se registran solo por clase, y los loggers de httpx quedan en
WARNING (registran URLs). Los errores de transferencia nunca incluyen la URL. Las entradas se mantienen en memoria, sin disco.
