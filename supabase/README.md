# supabase/ — backend del probador virtual 3D

Base de datos (Postgres + RLS + pgvector + pg_cron), Storage y Edge Functions
(la API del MVP, docs/architecture.md §3). Los contratos están en
`packages/contracts` y las funciones importan sus tipos y JSON Schemas
directamente (`functions/deno.json` → `../../packages/contracts`), sin copiarlos.

## Región UE

El proyecto en la nube se crea en una región de la UE: **eu-central-1 (Fráncfort)**
o **eu-west-1 (Irlanda)**. La región se elige al crear el proyecto
(`supabase projects create … --region eu-central-1` o en el panel) y no se puede
cambiar después; no está en `config.toml`. Las Edge Functions se ejecutan cerca
de quien llama: lo que obliga a la UE son los datos (Postgres y Storage, en la
región del proyecto) y el worker GPU (Modal fijado a región UE). Documentar la
retención de copias de seguridad del plan contratado (afecta al borrado total).

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
│   └── 20261111000600_cron.sql                   # tareas pg_cron
├── functions/
│   ├── deno.json                    # mapa de imports (versiones fijadas) — también lo usan los tests e2e
│   ├── .env.example                 # variables necesarias, sin valores
│   ├── _shared/                     # contratos/Ajv, HMAC, Storage, despacho, cliente admin, HTTP
│   ├── create-job/                  # POST: crea job, devuelve URL firmada de subida; /uploaded despacha
│   ├── job-callback/                # POST del worker: HMAC, valida JobCallback, borra la foto, persiste
│   ├── delete-account/              # DELETE: borrado total RGPD
│   └── maintenance/                 # POST desde pg_cron: despacho, borrado de fotos, barrido 60 min, GC
└── tests/
    ├── database/*.test.sql          # pgTAP: RLS, cola, persistencia, reintentos, consentimientos, cascada
    └── e2e/photo_deletion.test.ts   # Deno: ciclo completo contra el stack local, ficheros incluidos
```

## Modelo de datos

Tablas en `public`, todas con RLS: `profiles` (los "users" del plan), `consents`,
`avatars`, `color_profiles`, `garments`, `garment_measurements`, `fit_results`,
`user_fit_preferences`, `outfits`, `store_products`, `drape_cache`, `jobs` y
`job_runs` (datos internos de despacho; solo service_role).

- Columnas = campos del contrato en snake_case; objetos anidados en `jsonb`;
  enums de Postgres con los mismos valores que las constantes del contrato.
- Excepción: los `*_url` del contrato que apuntan a Storage privado se guardan
  como **ruta** en `*_path` (`avatars.glb_path`, `garments.image_path`,
  `garments.glb_path`, `outfits.preview_path`, `drape_cache.glb_path`). La app
  firma la ruta con `storage.from('assets').createSignedUrl(path sin "assets/")`
  (las políticas lo permiten para lo propio). En `jobs.output` las URLs quedan
  como `storage://<ruta>`, tal como las envía el worker.
- `Garment.measurements` vive en `garment_measurements`; la vista
  `garments_with_measurements` (security_invoker) devuelve el Garment completo.
- Embeddings: `garments.embedding vector(512)` (CLIP/FashionCLIP) con índice HNSW coseno.
- Todo cuelga de `auth.users` con `ON DELETE CASCADE`.

Qué puede hacer la app con su JWT (resumen de RLS):

| Tabla | Leer | Escribir |
|---|---|---|
| profiles | lo propio | `display_name`, `locale`, `age_confirmed_at` |
| consents | lo propio | insertar propios; retirar (`withdrawn_at`), nunca reactivar ni borrar |
| avatars | lo propio | `measurements_override`; borrar |
| color_profiles | lo propio | estación/paleta a mano; borrar |
| garments, garment_measurements | lo propio + catálogo (`user_id` null) | CRUD de lo propio; crear solo en `processing` |
| fit_results, drape_cache | lo propio (vía avatar / user_id) | borrar fit_results |
| user_fit_preferences, outfits | lo propio | CRUD de lo propio |
| store_products | todos (anon incluido) | nada |
| jobs | lo propio (también Realtime) | nada: se crean con `create-job` |

Retirar un consentimiento (trigger): `body_scan` borra los avatares obtenidos
de fotos (y en cascada fit_results y drape_cache) y cancela jobs de avatar;
`color_analysis` borra los perfiles de color no elegidos a mano; `personalization`
borra los outfits recomendados. Los GLB que quedan sin referencia los borra el GC.

## Storage

| Bucket | Contenido | Acceso |
|---|---|---|
| `raw-uploads` (privado, 10 MB, jpeg/png/webp) | fotos de cuerpo, selfies, fotos de prenda: `raw-uploads/<uid>/<nombre>.jpg` | Subida solo con URL firmada de `create-job`; lectura solo el worker (URL firmada 15 min); el dueño puede borrar |
| `assets` (privado, 50 MB) | `<uid>/avatars/`, `<uid>/garments/`, `<uid>/drapes/` (los escribe el worker con URL firmada), `<uid>/outfits/` (la app), `catalog/` | El dueño lee lo suyo; `catalog/` lo lee cualquiera |

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

Contrato del worker: recibe `JobDispatch` por POST con `Authorization: Bearer
$WORKER_DISPATCH_TOKEN`; sube cada artefacto con `PUT` a `output_uploads[].upload_url`;
devuelve los artefactos como `storage://<path>`; firma los callbacks con
`x-probador-signature: sha256=<hex(HMAC-SHA256(JOB_CALLBACK_SECRET, cuerpo))>`.
Si el callback recibe 503 (no pudo borrar la foto) debe reintentarlo.

## Variables de entorno (sin valores)

Edge Functions (`supabase secrets set` en la nube; `functions/.env` en local, ver `functions/.env.example`):

| Variable | Obligatoria | Uso |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | las inyecta Supabase | cliente admin |
| `JOB_CALLBACK_SECRET` | sí | HMAC de los callbacks (compartido con el worker) |
| `MAINTENANCE_SECRET` | sí | autentica a pg_cron en `maintenance` |
| `WORKER_DISPATCH_URL` | para despachar | endpoint de Modal (UE). Vacío = los jobs esperan en cola |
| `WORKER_DISPATCH_TOKEN` | recomendada | Bearer hacia el worker |
| `JOB_CALLBACK_URL` | no | URL de callback enviada al worker (por defecto la del proyecto) |
| `PUBLIC_SUPABASE_URL` | solo local | reescribe el origen de las URLs firmadas (dentro de Docker es `http://kong:8000`) |
| `JOB_DAILY_QUOTA` | no (50) | jobs por usuario y 24 h |
| `DRAPE_SIMULATOR_VERSION` | no | entra en la clave de caché del drapeado |

Vault de Postgres (para que pg_cron llame a `maintenance`), una vez por entorno:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');   -- en local: 'http://kong:8000'
select vault.create_secret('<mismo valor que MAINTENANCE_SECRET>', 'maintenance_secret');
```

Sin estos secretos `jobs-reap` sigue funcionando, pero no hay despacho por cron
ni barrido de fotos (queda un `WARNING` en el log de Postgres).

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
Despliegue: `npx supabase link --project-ref <ref>`, `npx supabase db push`,
`npx supabase functions deploy`, `npx supabase secrets set --env-file …`.

## Tests

```bash
npx supabase test db                                       # pgTAP (tests/database)
npx supabase db lint --level warning                       # plpgsql_check

# e2e: necesita functions serve con WORKER_DISPATCH_URL=http://host.docker.internal:8787/dispatch,
# JOB_CALLBACK_URL=http://127.0.0.1:54321/functions/v1/job-callback y PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
eval "$(npx supabase status -o env | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|DB_URL)=')"
cd supabase
SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_DB_URL=$DB_URL \
JOB_CALLBACK_SECRET=<el de functions/.env> MAINTENANCE_SECRET=<el de functions/.env> \
deno test --config functions/deno.json --allow-net --allow-env --allow-read tests/e2e/

deno check --config functions/deno.json functions/*/index.ts
```

El e2e hace de worker falso en el puerto 8787: crea un usuario, pide un job,
sube la foto con la URL firmada, recibe el `JobDispatch`, sube un GLB, manda
callbacks (firma inválida, fuera de contrato, intento viejo, éxito, fallo) y
comprueba que la foto desaparece de Storage; después prueba el barrido de 60 min
y que `delete-account` deja Storage vacío y borra el usuario.

## Pendiente / límites conocidos

- `POST /consents` (registro de consentimientos) no es una función: la app
  inserta en `consents` con RLS. Si el texto legal tiene que validarse en
  servidor, añadir la función.
- Exportación de datos (portabilidad) no implementada.
- Las URLs firmadas de subida de Supabase caducan a las 2 h (no configurable),
  no a los 15 min del documento de arquitectura; las de descarga sí son de 15 min.
- `delete-account` borra también `consents`; si hace falta conservar prueba del
  consentimiento tras la baja, decidirlo con legal.
- No probado contra un proyecto en la nube (`db push`/`functions deploy`): en
  local las funciones importan `packages/contracts` fuera de `supabase/` y
  funciona; confirmar que el empaquetado del deploy también lo incluye.
