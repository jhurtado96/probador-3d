# supabase/ — backend del probador virtual 3D

Base de datos (Postgres + RLS + pgvector + pg_cron), Storage y Edge Functions
(la API del MVP, docs/architecture.md §3). Los contratos están en
`packages/contracts` y las funciones importan sus tipos y JSON Schemas
directamente (`functions/deno.json` → `../../packages/contracts`), sin copiarlos.

## Región UE

El proyecto en la nube está en **eu-west-3 (París)** (`probador-3d`, ref
`jxynipwqucetmeayyupi`). La región se elige al crear el proyecto y no se puede
cambiar después; no está en `config.toml`. Documentar la retención de copias de
seguridad del plan contratado (afecta al borrado total).

### Región de ejecución de las Edge Functions (revisión M3, verificada el 2026-11-12)

Comprobado en el proyecto con llamadas desde la base de datos (pg_net, París) y
la cabecera de respuesta `x-sb-edge-region`:

- Sin indicar nada, las seis funciones se ejecutan en **eu-west-3**.
- Quien llama puede elegir la región: con la cabecera `x-region: eu-central-1` la
  misma llamada corrió en eu-central-1, y con `?forceFunctionRegion=us-east-1`, en
  **us-east-1**. Es decir, por defecto se ejecuta cerca de quien llama, y un
  cliente fuera de la UE (o que lo pida) saca el procesamiento de la UE.

Medidas:

1. `pg_net` (`private.invoke_maintenance`) envía `x-region: eu-west-3`
   (migración `20261112000100_deploy_fixes.sql`).
2. Worker: los secretos `JOB_CALLBACK_URL` y `JOB_DISPATCH_URL` llevan
   `?forceFunctionRegion=eu-west-3` (ver «Despliegue en la nube»). La firma HMAC
   cubre solo el cuerpo, así que el parámetro no la afecta.
3. App: todas las llamadas llevan `?forceFunctionRegion=eu-west-3`
   (`apps/app/src/lib/api.ts`). No usa `functions.invoke(..., { region })`
   porque añade la cabecera `x-region`, que el CORS de las funciones no admite
   (`docs/integration-issues.md`, conexión de la app, punto 1).
4. Pendiente del usuario: repetir la prueba desde fuera de la UE (con y sin
   región fijada) antes de abrir el servicio, guardar la evidencia con la EIPD y
   añadir Supabase Edge Functions (eu-west-3) a la lista de subencargados.

## Estructura

```
supabase/
├── config.toml                      # stack local; [functions.*] con import_map y verify_jwt
├── migrations/
│   ├── 20261111000100_extensions_and_types.sql   # pgvector, pg_cron, pg_net, enums del contrato
│   ├── 20261111000200_core_tables.sql            # tablas, índices, triggers, vista garments_with_measurements
│   ├── 20261111000300_rls.sql                    # RLS + privilegios por columna
│   ├── 20261111000400_storage.sql                # buckets raw-uploads y assets + políticas
│   ├── 20261111000500_job_queue.sql              # cola, complete_job, reaper, barridos, retirada de consentimiento
│   ├── 20261111000600_cron.sql                   # tareas pg_cron
│   ├── 20261111000700_consent_archive.sql        # D6: archivo bloqueado y seudonimizado de consentimientos
│   ├── 20261111000800_data_export.sql            # D7: cuota de export-data
│   ├── 20261111000900_job_retention.sql          # D9/D10: jobs sin datos personales, cascadas, purga a 30 días
│   ├── 20261111001000_consent_texts.sql          # D13: textos versionados, prueba fijada por el servidor
│   ├── 20261111001100_storage_guard.sql          # D14: subidas solo si un job activo las espera; GC 10 min
│   ├── 20261111001200_ops_alerts.sql             # M6: alertas consultables y privacy-watchdog
│   ├── 20261111001300_dispatch_fetch.sql         # D11: entrega única del despacho; cuota atómica; M4; B2; B6
│   └── 20261112000100_deploy_fixes.sql           # M3: región fija en pg_net; índices de dos FK (advisor)
├── functions/
│   ├── deno.json                    # mapa de imports (versiones fijadas) — también lo usan los tests e2e
│   ├── _shared/validate_*.ts        # un módulo por JSON Schema: cada función carga solo los suyos
│   ├── .env.example                 # variables necesarias, sin valores
│   ├── _shared/                     # contratos/Ajv, HMAC, Storage, despacho, cliente admin, HTTP
│   ├── create-job/                  # POST: crea job, devuelve URL firmada de subida; /uploaded despacha
│   ├── job-dispatch/                # POST del worker: HMAC, entrega el JobDispatch una vez por intento (D11)
│   ├── job-callback/                # POST del worker: HMAC, valida JobCallback, borra la foto, persiste
│   ├── delete-account/              # DELETE: borrado total RGPD (archiva antes los consentimientos)
│   ├── export-data/                 # GET: exportación de datos en JSON (arts. 15 y 20 RGPD)
│   └── maintenance/                 # POST desde pg_cron: despacho, borrado de fotos, barrido 60 min, GC
├── scripts/bundle_functions.ts      # empaqueta cada función para desplegarla (M3/punto 25), en .deploy/
└── tests/
    ├── database/*.test.sql          # pgTAP: RLS, cola, persistencia, reintentos, consentimientos, cascada,
    │                                #        archivo de consentimientos (D6), cuota de exportación (D7) y
    │                                #        arreglos de la revisión (04_review_fixes: D9–D14, M4, M6, B1–B9)
    └── e2e/photo_deletion.test.ts   # Deno: ciclo completo contra el stack local, ficheros, exportación y baja
```

## Modelo de datos

Tablas en `public`, todas con RLS: `profiles` (los "users" del plan), `consents`,
`avatars`, `color_profiles`, `garments`, `garment_measurements`, `fit_results`,
`user_fit_preferences`, `outfits`, `store_products`, `drape_cache`, `jobs` y
`job_runs` (datos internos de despacho; solo service_role).

- Columnas = campos del contrato en snake_case; objetos anidados en `jsonb`;
  enums de Postgres con los mismos valores que las constantes del contrato.
  Todas las tablas tienen tipo en el contrato (v0.4.0), incluidas `profiles`
  (`Profile`), `consents` (`Consent`), `user_fit_preferences`
  (`UserFitPreferences`) y `drape_cache` (`DrapeCache`).
- Excepción: los `*_url` del contrato que apuntan a Storage privado se guardan
  como **ruta** en `*_path` (`avatars.glb_path`, `garments.image_path`,
  `garments.glb_path`, `garments.sewing_pattern_path`, `outfits.preview_path`,
  `drape_cache.glb_path`; la tabla es `STORAGE_URL_COLUMNS` en el contrato). La app
  firma la ruta con `storage.from('assets').createSignedUrl(path sin "assets/")`
  (las políticas lo permiten para lo propio). `jobs.output` no guarda la salida
  del worker sino ids (`JobResult`, D9).
- **`jobs` sin datos personales (D9)**: al terminar, `input` se queda en sus ids
  (`consent_id`, `avatar_id`, `garment_id`) y `output` en referencias; un trigger lo
  garantiza venga de donde venga la escritura. Retirar un consentimiento o borrar
  un avatar, un perfil de color o una prenda llega también a `jobs`.
  `purge_finished_jobs` (en `maintenance-daily`) borra los terminados con más de
  30 días, salvo los que aún tienen fotos por borrar.
- El avatar no depende de la topología del modelo corporal: `avatars.body_model`
  (`mhr`, `anny`, `smplx`), `model_version` y un vector de forma opaco (`shape`).
- `jobs.input_deleted_at` (cuándo se borraron las fotos) y `jobs.fake` los
  escribe solo la API; el worker no declara el borrado.
- `garments.sewing_pattern_path`: patrón GarmentCode del que sale el GLB y que
  simula el drapeado. `fit_results.user_id` = dueño del avatar (RLS directo).
- `Garment.measurements` vive en `garment_measurements`; la vista
  `garments_with_measurements` (security_invoker) devuelve el Garment completo.
- Embeddings: `garments.embedding vector(512)` (CLIP/FashionCLIP) con índice HNSW coseno.
  Llega en `GarmentJobOutput.embedding`; no se guarda en `jobs.output` ni se sirve a la app.
- Todo cuelga de `auth.users` con `ON DELETE CASCADE`, salvo el archivo de
  consentimientos (abajo).
- `data_export_requests`: cuándo pidió cada usuario una exportación (cuota de
  `export-data`); solo service_role, se purga a los 30 días.

### Textos y prueba del consentimiento (D13)

`consent_texts(purpose, version, body, sha256, published_at)` es pública y de solo
inserción; la versión vigente de cada tratamiento es la última publicada
(`current_consent_text_version`). Los textos sembrados son **borradores**: los
definitivos se publican con una migración nueva, nunca editando una fila. La app
inserta en `consents` solo `purpose` (y, opcionalmente, `text_version`, que tiene
que ser la vigente); `granted_at`, `created_at` y `withdrawn_at` los pone el
servidor y la fila no se puede reescribir (ni con service_role).

### Archivo de consentimientos (D6)

Al borrar una fila de `consents` (la cascada de `delete-account`, un borrado del
usuario desde el panel de Auth o cualquier `DELETE`), el trigger
`consents_archive_before_delete` copia antes a `consent_records_archive` un
registro mínimo: `user_hash` = HMAC-SHA256(secreto de Vault
`consent_pseudonym_secret`, user_id) en hex, `purpose`, `text_version`,
`granted_at`, `withdrawn_at` (la fecha de la baja si seguía vigente),
`archived_at` y `email_hash` = HMAC-SHA256(mismo secreto, `"email:" +
lower(trim(email))`), que se calcula antes de que la baja borre el email (D13).
Nada más: ni el user_id, ni el email, ni el id del consentimiento.

- Bloqueado (art. 32 LOPDGDD; finalidad art. 7.1 RGPD, en el comentario SQL de
  la tabla): RLS sin políticas, sin privilegios para anon/authenticated;
  service_role solo puede leer. Nadie salvo el trigger y la purga escribe; la purga
  solo la ejecuta pg_cron (ni service_role, B1).
- `consent-archive-purge` (pg_cron, diaria) borra lo que lleva más de 3 años archivado.
- Sin el secreto en Vault la baja falla entera (no se pierde la prueba ni se
  guarda el user_id en claro); `delete-account` lo comprueba antes de vaciar
  Storage y responde 500 sin borrar nada.
- Para atender una reclamación: `select * from public.consent_archive_lookup(p_email => '<email>')`
  (o `p_user_id => '<uuid>'`), solo con service_role y solo para esa finalidad
  (art. 32 LOPDGDD). El HMAC se calcula dentro de Postgres. El secreto no se puede
  rotar sin perder esa correspondencia: guardar una copia fuera de la base de datos.
- Retirar un consentimiento en vida no borra la fila (solo los datos
  derivados): sigue en `consents` como prueba, el usuario la ve y la exporta, y
  se archiva con su fecha real de retirada cuando se borra la cuenta.

### Exportación de datos (D7)

`GET export-data` (JWT del usuario) responde un `DataExport` del contrato:
cuenta (id, email, alta), perfil, consentimientos, avatares con medidas,
perfiles de color, prendas con medidas, fit_results, user_fit_preferences,
outfits, caché de drapeado, embeddings de las prendas y jobs con lo que queda
de ellos (entrada sin rutas de fotos y salida, que son ids); los ficheros
van como URLs firmadas de 1 h (`null` si el fichero ya no existe) y hay notas
legibles (las fotos originales no se conservan). Lee con el JWT del usuario
(RLS) y además filtra por su id; pagina de 1000 en 1000; valida la respuesta
contra `data_export.schema.json` antes de enviarla (500 si no cuadra, sin
registrar datos). Cuota: `DATA_EXPORT_DAILY_QUOTA` (5) por 24 h → 429
`quota_exceeded`.

Qué puede hacer la app con su JWT (resumen de RLS):

| Tabla | Leer | Escribir |
|---|---|---|
| profiles | lo propio | `display_name`, `locale`, `age_confirmed_at` |
| consent_texts | todo (anon incluido) | nada |
| consents | lo propio | insertar propios (solo `purpose` y `text_version` vigente); retirar (`withdrawn_at`), nunca reactivar, reescribir ni borrar |
| avatars | lo propio | `measurements_override` (claves de BodyMeasurements, rangos plausibles; invalida la caché de drapeado); borrar |
| color_profiles | lo propio | estación/paleta a mano; borrar |
| garments, garment_measurements | lo propio + catálogo (`user_id` null) | CRUD de lo propio salvo `status`; crear solo en `processing` |
| fit_results, drape_cache | lo propio (vía avatar / user_id) | borrar fit_results |
| user_fit_preferences, outfits | lo propio | CRUD de lo propio |
| store_products | todos (anon incluido) | nada |
| jobs | lo propio (también Realtime) | nada: se crean con `create-job` |

Retirar un consentimiento (trigger): `body_scan` cancela los jobs de avatar,
borra los avatares obtenidos de fotos (y en cascada fit_results, drape_cache y
lo que de ellos quedaba en jobs); `color_analysis` cancela los jobs de color y
borra **todos** los perfiles de color, también los corregidos a mano (D10);
`personalization` borra los outfits recomendados. Los GLB que quedan sin
referencia los borra el GC enseguida (pg_net → maintenance) y, como red, cada 10 minutos.

## Storage

| Bucket | Contenido | Acceso |
|---|---|---|
| `raw-uploads` (privado, 10 MB, jpeg/png/webp) | fotos de cuerpo, selfies, fotos de prenda: `raw-uploads/<uid>/<nombre>.jpg` | Subida solo con URL firmada de `create-job`; lectura solo el worker (URL firmada 15 min); el dueño puede borrar |
| `assets` (privado, 50 MB) | `<uid>/avatars/`, `<uid>/garments/<garment_id>/` (GLB, recorte y patrón), `<uid>/drapes/` (los escribe el worker con URL firmada), `<uid>/outfits/` (la app), `catalog/` | El dueño lee lo suyo; `catalog/` lo lee cualquiera |

URLs firmadas: las de descarga que recibe el worker duran 15 min. Las de subida
duran 2 h (límite fijo de Supabase, aceptado; ver el registro de decisiones de
`docs/architecture.md`). Lo compensan: la ruta de salida es única por job e
intento (`<job_id>-a<attempt>`), el callback solo acepta las rutas emitidas para
el intento en curso, y sobre todo el **guard de Storage (D14)**: un trigger en
`storage.objects` solo admite la subida si un job activo la espera (foto de un job
en cola, salida autorizada del intento en curso, miniaturas de outfits, catálogo).
Storage lo evalúa al firmar la URL y al subir, así que terminar, cancelar o
caducar el job (también por baja o retirada) invalida cualquier URL pendiente.
Los INSERT directos por SQL de la sesión `postgres` no pasan por el guard (los
tests lo activan con `set local probador.storage_guard = 'on'`).

Borrado de fotos: (1) `job-callback` borra las entradas antes de cerrar el job,
termine bien o mal; (2) `maintenance` borra cada minuto las de jobs terminados
que no constan como borradas (timeouts, cancelados); (3) **barrido**: cualquier
objeto de `raw-uploads` con más de 60 minutos. Los ficheros se borran siempre
por la API de Storage: un `DELETE` en `storage.objects` lo bloquea Supabase y,
además, dejaría el fichero.

## Cola de jobs

`create-job` inserta el job `queued` y devuelve una URL firmada por foto aún no
subida. La app sube con `storage.from('raw-uploads').uploadToSignedUrl(nombre, token, fichero)`
y llama a `POST create-job/uploaded {job_id}`; si no lo hace, pg_cron lo despacha
en menos de un minuto. El despacho (`claim_jobs_for_dispatch`) solo reserva jobs
con todas sus fotos presentes, consume un intento y fija un plazo (10 min; 5 min
color). `reap_stale_jobs` (pg_cron, cada minuto) devuelve a la cola los intentos
vencidos, marca `failed/timeout` el tercero y `failed/invalid_input` los jobs
cuyas fotos no llegaron en 60 min. Los callbacks con `attempt` distinto del actual
se descartan (409) y los de jobs terminados son idempotentes.

Despacho en dos pasos (D11): la API envía al worker un `JobDispatchNotice`
(`job_id`, tipo, intento, `dispatch_url`, versión del contrato: nada personal) y el
contenedor pide el `JobDispatch` a `job-dispatch` con un `JobDispatchFetch` firmado
con `PROBADOR_CALLBACK_SECRET`. `claim_job_dispatch_fetch` lo entrega una sola vez
por intento y dentro de plazo (409 si no). La cuota se cuenta e inserta en una
sola transacción (`enqueue_job`, B8). Si hay una alerta `raw_uploads_overdue`
abierta, `create-job` responde 503 `scans_paused` a los jobs con fotos (M6).

Contrato del worker: el `JobDispatch` lleva `user_id`,
`contracts_version` y, en el drapeado, `context`: GLB del avatar, patrón y GLB
de la prenda, medidas, tejido y `cache_key`); sube cada artefacto con un único
`PUT` a `output_uploads[].upload_url` con su `content_type`; devuelve los
artefactos como `storage://<path>`. Despacho y callback se firman igual
(`_shared/hmac.ts`, especificado en `packages/contracts`):
`x-probador-timestamp: <segundos Unix>` y
`x-probador-signature: sha256=<hex(HMAC-SHA256(secreto, "<timestamp>." + cuerpo))>`,
con `PROBADOR_DISPATCH_SECRET` hacia el worker y `PROBADOR_CALLBACK_SECRET` de
vuelta; más de 300 s de desfase se rechaza (401). Los callbacks con `fake: true`
se rechazan (422 `fake_not_allowed`) salvo con `PROBADOR_ALLOW_FAKE_WORKERS=1`.
Si el callback recibe 503 (no pudo borrar la foto) debe reintentarlo.

## Variables de entorno (sin valores)

Edge Functions (`supabase secrets set` en la nube; `functions/.env` en local, ver `functions/.env.example`):

| Variable | Obligatoria | Uso |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | las inyecta Supabase | cliente admin |
| `PROBADOR_CALLBACK_SECRET` | sí | HMAC de los callbacks (mismo nombre y valor en el worker) |
| `PROBADOR_DISPATCH_SECRET` | para despachar | HMAC del despacho (mismo nombre y valor en el worker). Sin él no se despacha |
| `PROBADOR_ALLOW_FAKE_WORKERS` | no | `1` acepta callbacks de workers fake. Solo desarrollo |
| `MAINTENANCE_SECRET` | sí | autentica a pg_cron en `maintenance` |
| `WORKER_DISPATCH_URL` | para despachar | endpoint de Modal (UE). Vacío = los jobs esperan en cola |
| `JOB_CALLBACK_URL` | no | URL de callback enviada al worker (por defecto la del proyecto) |
| `JOB_DISPATCH_URL` | no | URL de `job-dispatch` que va en el aviso de despacho (por defecto la del proyecto) |
| `PUBLIC_SUPABASE_URL` | solo local | reescribe el origen de las URLs firmadas (dentro de Docker es `http://kong:8000`) |
| `JOB_DAILY_QUOTA` | no (50) | jobs por usuario y 24 h |
| `DATA_EXPORT_DAILY_QUOTA` | no (5) | exportaciones de datos por usuario y 24 h |
| `DRAPE_SIMULATOR_VERSION` | no | entra en la clave de caché del drapeado |

Vault de Postgres (para que pg_cron llame a `maintenance`), una vez por entorno:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');   -- en local: 'http://kong:8000'
select vault.create_secret('<mismo valor que MAINTENANCE_SECRET>', 'maintenance_secret');
select vault.create_secret('<32+ caracteres aleatorios>', 'consent_pseudonym_secret');  -- D6
```

Opcional: `select vault.create_secret('<https://webhook…>', 'ops_alert_webhook_url');`
para recibir por pg_net cada alerta nueva de `ops_alerts`.

Sin los dos primeros `jobs-reap` sigue funcionando, pero no hay despacho por cron
ni barrido de fotos: se abre la alerta `maintenance_not_configured`.

### Alertas de privacidad (M6)

`privacy-watchdog` (pg_cron, cada 5 min, SQL sin HTTP) ejecuta
`check_privacy_invariants()` y mantiene `ops_alerts` (una fila abierta por tipo,
se cierra sola): `raw_uploads_overdue` (fotos con más de 75 min),
`maintenance_not_configured` y `maintenance_http_failed` (todas las llamadas a
`maintenance` de los últimos 15 min fallaron). Consulta:
`select * from public.ops_alerts where resolved_at is null;` (service_role). Sin
`consent_pseudonym_secret` no se puede borrar ninguna cuenta con
consentimientos (el secreto del seudónimo vive solo en Vault, no en las
variables de las funciones; los tests pgTAP y e2e crean uno temporal si falta).

## Levantarlo en local

Requisitos: Docker, Node 20+ (para `npx supabase`), Deno 2 (tests e2e y `deno check`).

```bash
cd probador-3d                      # raíz del monorepo (el CLI busca ./supabase)
npx supabase start                  # aplica las migraciones
cp supabase/functions/.env.example supabase/functions/.env   # y rellenar valores locales
npx supabase functions serve --env-file supabase/functions/.env
# opcional: secretos de Vault con project_url = http://kong:8000 (ver arriba)
```

Reiniciar la base desde cero: `npx supabase db reset`.
Despliegue: `npx supabase link --project-ref jxynipwqucetmeayyupi`, `npx supabase db push`
y las funciones desde `supabase/.deploy/` (ver «Despliegue en la nube»).

## Despliegue en la nube (estado a 2026-11-12)

Proyecto `probador-3d`, URL `https://jxynipwqucetmeayyupi.supabase.co`, región
eu-west-3. Desplegado con las herramientas MCP de Supabase.

- **Migraciones:** las 14 de `migrations/` aplicadas sin cambios; en
  `supabase_migrations.schema_migrations` llevan la misma versión que el nombre
  del fichero, así que `supabase db push` las da por aplicadas.
- **Vault:** creados `project_url`, `maintenance_secret` y
  `consent_pseudonym_secret` (los dos últimos, 32 bytes aleatorios generados en el
  servidor; nadie los ha visto). Guardar una copia de `consent_pseudonym_secret`
  fuera de la base de datos (panel → Vault) y no rotarlo.
- **Edge Functions** (todas `ACTIVE`, versión 1): `create-job`,
  `delete-account` y `export-data` con `verify_jwt = true`; `job-callback`,
  `job-dispatch` y `maintenance` con `verify_jwt = false` (como en `config.toml`).
- **Empaquetado (punto 25 / M3):** las funciones importan `packages/contracts`,
  fuera de `supabase/`. `scripts/bundle_functions.ts` genera para cada función en
  `supabase/.deploy/<función>/` (ignorado por git) un `index.js` con la función,
  `_shared/` y las constantes del contrato (`deno bundle`, sin minificar), un
  `deno.json` con los `npm:` fijados y `@probador/contracts/schemas/` →
  `./contracts/schemas/`, y solo los JSON Schemas que la función importa (sin
  espacios). Se despliega esa carpeta (entrypoint `index.js`, import map
  `deno.json`). El desarrollo local no cambia. Para redesplegar:
  `deno run --allow-read --allow-write --allow-run --allow-env supabase/scripts/bundle_functions.ts`
  y subir los ficheros de `.deploy/<función>/`.
- **Pruebas de humo** (sin credenciales, desde pg_net): `create-job`,
  `export-data` y `delete-account` → 401 (también con la clave anon, ya dentro
  del código de la función); `maintenance` → 401. `job-callback` y
  `job-dispatch` → 500 «missing environment variable PROBADOR_CALLBACK_SECRET»
  hasta que se cree ese secreto; después deben dar 401.
- **Advisors:** seguridad, solo `rls_enabled_no_policy` (INFO) en
  `consent_records_archive`, `data_export_requests`, `job_runs` y `ops_alerts`:
  intencionado, son tablas solo de service_role. Rendimiento: índices para las
  FK `consents (purpose, text_version)` y `drape_cache.fit_result_id` (añadidos
  en `20261112000100`); `consent_records_archive` sin clave primaria
  (intencionado: guarda solo los campos de D6) e índices sin uso (base vacía).
- **Auth:** sin cambios respecto a la configuración por defecto del proyecto.
- **Tests tras los cambios:** `deno fmt`, `deno check`, `deno lint` y los unitarios
  pasan; pgTAP (`supabase test db`) y e2e no se han podido ejecutar (sin Docker en
  el entorno del despliegue): pasarlos en local antes del siguiente cambio.

### Pendiente en el panel (usuario)

Secretos de Edge Functions (Edge Functions → Secrets):

| Secreto | Valor |
|---|---|
| `MAINTENANCE_SECRET` | copiar el valor de Vault `maintenance_secret` (Database → Vault). Hasta entonces pg_cron recibe 500 cada minuto y queda abierta la alerta `maintenance_http_failed` |
| `PROBADOR_CALLBACK_SECRET` | 32+ bytes aleatorios; el mismo en el worker de Modal |
| `PROBADOR_DISPATCH_SECRET` | 32+ bytes aleatorios; el mismo en el worker de Modal |
| `JOB_CALLBACK_URL` | `https://jxynipwqucetmeayyupi.supabase.co/functions/v1/job-callback?forceFunctionRegion=eu-west-3` |
| `JOB_DISPATCH_URL` | `https://jxynipwqucetmeayyupi.supabase.co/functions/v1/job-dispatch?forceFunctionRegion=eu-west-3` |
| `WORKER_DISPATCH_URL` | **no crear todavía** (no hay worker en Modal): los jobs se quedan en cola y caducan a los 60 min |

No crear `PROBADOR_ALLOW_FAKE_WORKERS` ni `PUBLIC_SUPABASE_URL` en la nube.
Además: Auth (URLs de redirección, proveedores, SMTP propio) cuando exista la app.

## Tests

```bash
npx supabase test db                                       # pgTAP (tests/database)
npx supabase db lint --level warning                       # plpgsql_check

# e2e: necesita functions serve con WORKER_DISPATCH_URL=http://host.docker.internal:8787/dispatch,
# JOB_CALLBACK_URL=http://127.0.0.1:54321/functions/v1/job-callback,
# JOB_DISPATCH_URL=http://127.0.0.1:54321/functions/v1/job-dispatch y PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
eval "$(npx supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
cd supabase
SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_DB_URL=$DB_URL \
PROBADOR_CALLBACK_SECRET=<el de functions/.env> PROBADOR_DISPATCH_SECRET=<ídem> MAINTENANCE_SECRET=<ídem> \
deno test --config functions/deno.json --allow-net --allow-env --allow-read tests/e2e/

deno test --config functions/deno.json --allow-read tests/unit/      # firma HMAC, sin stack local
deno check --config functions/deno.json functions/*/index.ts tests/*/*.ts
```

El e2e hace de worker falso en el puerto 8787: crea un usuario, comprueba que no
puede fijar la fecha del consentimiento, pide un job, sube la foto con la URL
firmada, recibe el aviso de despacho (solo ids), pide el `JobDispatch` a
`job-dispatch` (firma, entrega única), sube un GLB, manda
callbacks (firma inválida, firma antigua, worker fake, fuera de contrato, intento viejo, éxito, fallo) y
comprueba que la foto desaparece de Storage y que `jobs` solo conserva ids; que las
URLs de subida dejan de servir al cerrar el job (M2, B5); después prueba el barrido de 60 min,
que `export-data` devuelve un `DataExport` válido (URLs que descargan los
ficheros, sin rutas internas, sin datos de un segundo usuario, cuota 429) y
que `delete-account` deja Storage vacío, borra el usuario y deja su
consentimiento archivado con el HMAC de su id.

## Pendiente / límites conocidos

- `POST /consents` no es una función: la app inserta en `consents` con RLS y el
  servidor fija fecha y versión (D13). Faltan los textos legales definitivos.
- M3: verificado y mitigado en pg_net, en las URLs del worker y en la app;
  falta repetir la prueba desde fuera de la UE (ver arriba).
- D6 (archivo de consentimientos) y D7 (`export-data`) están implementados;
  falta la revisión legal del plazo de 3 años y del bloqueo antes del lanzamiento.
- Desplegado en la nube (ver «Despliegue en la nube»). `supabase functions deploy`
  directo desde `functions/` no se ha probado (no hay token del CLI en este
  entorno); el camino probado es el paquete de `scripts/bundle_functions.ts`.
