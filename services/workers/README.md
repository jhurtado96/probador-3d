# probador-workers

Esqueleto de los workers GPU (`avatar`, `garment`, `drape`, `color`) en Python 3.11+ con uv. **Aún no hay ML**: sin `--fake`
cada job termina con un callback `failed` (`code: not_implemented`, `retryable: false`).

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
modal_app.py      entrada Modal (región UE y GPU por tipo configurables)
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
PROBADOR_ENV=production PROBADOR_MODAL_REGION=eu-west modal deploy modal_app.py
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
| `PROBADOR_MODAL_REGION` | región Modal (solo en despliegue) | `eu-west` |
| `PROBADOR_GPU_AVATAR` / `_GARMENT` / `_DRAPE` / `_COLOR` | GPU por tipo (`none` = CPU); valores iniciales sin medir | `A10G` / `T4` / `A10G` / `T4` |
| `PROBADOR_MAX_DOWNLOAD_BYTES`, `PROBADOR_MAX_UPLOAD_BYTES`, `PROBADOR_HTTP_TIMEOUT_S` | límites | 25 MB, 64 MB, 30 s |

## Privacidad

**Fotos de prenda (M5, docs/architecture.md §7, D12).** El pipeline real de `garment` tiene que detectar personas (piel o
cara, con MediaPipe) en cada foto y, si aparece una, fallar con `person_detected` sin subir ningún recorte. Es un requisito
para activar el pipeline real; el esqueleto actual no procesa fotos (`not_implemented`).

Los logs son JSON con `job_id`, tipo, intento, etapa y duración. Se descartan campos con nombre sensible, se sustituye
cualquier URL o `storage://` en los valores, las excepciones se registran solo por clase, y los loggers de httpx quedan en
WARNING (registran URLs). Los errores de transferencia nunca incluyen la URL. Las entradas se mantienen en memoria, sin disco.
