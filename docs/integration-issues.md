# Problemas de integración tras la primera tanda

Recopilados de los informes de los agentes. (Los hallazgos posteriores de la revisión crítica están en `docs/reviews/2026-11-11-revision-fase0.md`, con su estado; contratos v0.4.0.) Reconciliados el 2026-11-11: cada punto está **resuelto** (con el cambio hecho) o **pendiente** (con el motivo). Las decisiones están en `docs/architecture.md` §7; los contratos, en `packages/contracts` v0.3.0 (v0.3.0 solo añade `DataExport`).

Resumen: 26 resueltos, 1 pendiente (27). Además quedan 2 implementaciones pendientes que no estaban en la lista (ver el final).

## A. Decisiones de investigación que cambian la arquitectura

1. **Avatar sin depender de SMPL-X.** Resuelto. Decisión D1: se sigue `avatar.md` (SAM 3D Body → MHR + ajuste de forma propio; medidas ISO 8559-1). Contrato: `BodyModel = mhr | anny | smplx`, `Avatar.shape` (vector opaco) sustituye a `Avatar.smplx`, se añade `measurements_sigma_cm`. Actualizados `docs/architecture.md`, `README.md`, la skill (`SKILL.md`, `references/proyecto.md`, `references/roles.md`), el enum `body_model` y la columna `avatars.shape`. Abierto, no bloquea: revisión legal de la SAM License y evaluar SOMA-X en P1.
2. **Prendas como patrón GarmentCode y drapeado con Newton/Warp.** Resuelto. Decisiones D3 y D4. Contrato: `Garment.sewing_pattern_url` / `sewing_pattern_format`, `GarmentAttributes.fabric` y `stretch`, artefacto de salida `sewing_pattern`, y `DrapeJobDispatch.context` con el GLB del avatar, el patrón y el GLB de la prenda. BD: `garments.sewing_pattern_path`.
3. **Face parsing.** Resuelto. Decisión D2: MediaPipe. Reflejado en `docs/architecture.md` §3.4 y en la skill.
4. **ColorProfile.** Resuelto. Un único tipo en `packages/contracts`, ampliado con lo que pedía `color.md` (`quality`, `ita`, `skin_hue_deg`, `hair_dyed`, `updated_at`); `color.md` §7 lleva la tabla de correspondencia. BD: columnas nuevas en `color_profiles`.
5. **Fit.** Resuelto. El fit de diseño vive en `Garment.design_fit` (+ `design_fit_confidence`); el fit en la persona, en `FitResult`, con incertidumbre por zona (`ZoneFit.ease_sigma_cm`, `verdict_probabilities`), `size_offset` y las zonas `cuff` y `knee`. `UserFitPreferences` modela la holgura preferida por categoría y zona de `fit.md` §6.

## B. Huecos en contratos (workers, `services/workers`)

6. **Firma HMAC sin especificar.** Resuelto. Especificada en `packages/contracts` («Firma de peticiones entre API y workers»): `x-probador-timestamp` + `x-probador-signature: sha256=<hex>` sobre `"<timestamp>." + cuerpo`, tolerancia de 300 s. Implementada en `services/workers/.../signing.py` y `supabase/functions/_shared/hmac.ts`; vector compartido en `packages/contracts/fixtures/signature-vector.json`, comprobado en Node, Python y Deno.
7. **Autenticación del dispatch.** Resuelto. La misma firma en los dos sentidos, un secreto por sentido con el mismo nombre en ambos lados (`PROBADOR_DISPATCH_SECRET`, `PROBADOR_CALLBACK_SECRET`). Se eliminan `WORKER_DISPATCH_TOKEN` y `JOB_CALLBACK_SECRET`. Sin secreto de despacho la API no despacha.
8. **`JobDispatch` sin `user_id`.** Resuelto. `JobDispatch.user_id` (y `contracts_version`); el worker lo copia en las entidades y `complete_job` comprueba que coincide con el dueño del job.
9. **`DrapeJobInput` solo con ids.** Resuelto. La app sigue enviando ids; la API añade `DrapeJobDispatch.context` (cuerpo, prenda, medidas, tejido y `cache_key`). Probado de punta a punta con el worker fake.
10. **`JobErrorCode`.** Resuelto. Añadidos `not_implemented` y `quota_exceeded`. El worker sin pipeline real falla con `not_implemented`.
11. **`input_deleted_at`.** Resuelto. Sale de las salidas del worker y pasa a `Job.input_deleted_at` (columna `jobs.input_deleted_at`), que escribe solo la API. Se elimina `job_runs.input_deleted_at`.
12. **Marca de salida falsa.** Resuelto. `JobCallback.fake` → `Job.fake`, más el prefijo `fake/` en las versiones. La API rechaza callbacks fake (422 `fake_not_allowed`) salvo con `PROBADOR_ALLOW_FAKE_WORKERS=1`.
13. **`Url` y `storage://`; PUT.** Resuelto. `Url` documenta los tres casos, se añade `StorageRef`, y `SignedUpload` documenta el `PUT` único con `content_type`.
14. **`measurements_source` sin «no medido».** Resuelto. Valor `unmeasured` (contrato y enum de Postgres).

## C. Huecos en contratos (backend, `supabase/`)

15. **Tipos que faltan.** Resuelto. `Consent` (+ `ConsentPurpose`), `UserFitPreferences`, `DrapeCache`, `Profile`, y también `CreateJobResponse` y `UploadTicket`, con sus JSON Schemas.
16. **Forma de error de la API.** Resuelto. `ApiErrorBody` y `ApiErrorCode`; `HttpError` de las funciones está tipado con ellos.
17. **`*_url` frente a `*_path`.** Resuelto documentando, sin renombrar: cabecera de `packages/contracts/src/index.ts` y constante `STORAGE_URL_COLUMNS`.
18. **`Garment` en `processing`.** Resuelto. `Garment = PendingGarment | ReadyGarment`, unión por `status`; el job devuelve `ReadyGarment`.
19. **Embedding.** Resuelto. `GarmentJobOutput.embedding` (512 dimensiones) → `garments.embedding`; no se guarda en `jobs.output` ni se sirve a la app.
20. **`Outfit.avatar_id`.** Resuelto. `UUID | null` en el contrato, como en la BD.
21. **`FitResult` sin `user_id`.** Resuelto. Añadido al contrato y a `fit_results` (RLS directo por `user_id`).
22. **`ColorProfile` sin `updated_at`.** Resuelto. Contrato, columna y trigger.
23. **Buckets.** Resuelto. La arquitectura adopta lo implementado: `raw-uploads` + `assets` con carpetas por usuario (§3.3 y D5). El bucket `assets` admite ahora `application/json` para los patrones.
24. **URLs firmadas de subida de 2 h.** Resuelto por decisión del usuario (D8): se aceptan. Mitigaciones documentadas y comprobadas: ruta única por job e intento, una sola subida por ruta (se quita `upsert`; el e2e verifica que la segunda subida falla), rutas autorizadas por intento, barrido a los 60 min. Desde la revisión de la fase 0 (D14) la URL deja además de servir en cuanto el job no la espera.
25. **Empaquetado de las Edge Functions.** **Resuelto** (2026-11-12). Desplegadas las seis funciones en el proyecto `jxynipwqucetmeayyupi` (eu-west-3). `supabase/scripts/bundle_functions.ts` empaqueta cada una con `_shared/` y las constantes de `packages/contracts` en un `index.js`, más los JSON Schemas que usa y un `deno.json` del despliegue que los apunta en `./contracts/schemas/`; el desarrollo local sigue importando `../../packages/contracts`. Para no subir los seis schemas a cada función, los validadores se separaron en `_shared/validate_*.ts`. Las seis responden y validan en la nube (pruebas de humo en `supabase/README.md`).

## D. Monorepo

26. **`package.json` raíz.** Resuelto. npm workspaces (`apps/*`, `packages/*`), un único `package-lock.json`, lockfiles sueltos eliminados, y `apps/app` depende de `@probador/contracts`. Comprobado con instalación limpia desde la raíz.
27. **`apps/app/.claude/settings.json` activa el plugin de Expo.** **Pendiente.** Motivo: decisión del usuario; no se ha tocado.

## Decididos por el usuario, fuera de la lista original

- **Consentimientos tras borrar la cuenta (D6).** **Implementado.** Un trigger copia cada consentimiento, antes de borrarlo, a `consent_records_archive` (HMAC-SHA256 del `user_id` con el secreto de Vault `consent_pseudonym_secret`, tratamiento, versión del texto, fechas de concesión, retirada o baja y archivo); la tabla está bloqueada (RLS sin políticas, solo lectura de service_role) y pg_cron la purga a los 3 años. Los retirados en vida no se borraban ni se borran: se archivan al darse de baja. Comprobado con pgTAP y e2e. Queda recomendada la revisión de un abogado antes del lanzamiento.
- **Exportación de datos (D7).** **Implementado.** `GET export-data` devuelve un `DataExport` (contratos v0.3.0) validado contra su JSON Schema, con URLs firmadas de 1 hora y cuota de 5 al día. Comprobado con e2e (JSON válido, solo datos propios, cuota).

## Otros asuntos que necesitan al usuario

- Revisión legal de la SAM License (SAM 3D Body) antes del MVP, y de si medidas corporales y perfil de color son categorías especiales (EIPD).
- Caché de drapeado compartida entre usuarios de cuerpo parecido (`drape.md` §4): hoy es por usuario; compartirla es una decisión de privacidad y de producto.
- `garment.md` propone un modelo de visión general para los atributos de la prenda: si es una API de terceros, hay que decidir si las fotos de prendas pueden salir de la infraestructura propia (la arquitectura lo prohíbe para fotos de personas).

## Prueba de punta a punta en la nube (2026-11-12)

Supabase (`jxynipwqucetmeayyupi`) → Modal (`probador-workers`, región `eu`) → Supabase, con un usuario de prueba y un job `avatar`:
cola → maintenance despacha (13:13:01) → Modal pide el JobDispatch (13:13:17) → callback `failed`/`not_implemented` (esperado, sin pipeline) → la API borra la foto (13:13:21, `input_deleted_at`, 0 objetos en `raw-uploads`).

Observaciones:
- **Arranque de GPU.** En un intento, la A10G en la UE tardó unos 7 minutos en estar disponible; en otros, 15 segundos. Antes del lanzamiento: contenedor caliente en horas punta o lista de GPUs alternativas.
- **Dispatch inválido sin callback.** Si el worker rechaza el JobDispatch por contrato (`dispatch_invalid`), no envía callback y el job sigue `queued` hasta su plazo; luego se reintenta y acaba `failed`. Funciona, pero tarda. Mejora: callback `failed` con `internal` cuando el aviso trae una URL de callback válida.

## Conexión de la app Expo al backend (2026-11-12)

La app (`apps/app`) ya usa el proyecto en la nube: acceso con email y contraseña, consentimientos, escaneo (job `avatar`), estado del job, exportación y borrado de cuenta, y armario (job `garment`). No se ha cambiado el backend desplegado; lo que sigue son incoherencias encontradas y cómo se adaptó la app.

1. **CORS no admite la cabecera `x-region`.** **Pendiente (backend).** `supabase.functions.invoke(..., { region: FunctionRegion.EuWest3 })` envía la cabecera `x-region` además del parámetro `?forceFunctionRegion`, y `_shared/http.ts` solo declara `authorization, x-client-info, apikey, content-type` en `Access-Control-Allow-Headers`: en el navegador la petición previa CORS fallaría. La app llama a las funciones con su propio `fetch` (`apps/app/src/lib/api.ts`) y fija la región solo con `?forceFunctionRegion=eu-west-3`, que basta (M3, verificado en `supabase/README.md`). Arreglo recomendado, pequeño: añadir `x-region` a `Access-Control-Allow-Headers` y redesplegar las funciones; después la app podría usar `functions.invoke` con `region`.
2. **Edad mínima sin comprobar en el servidor.** **Pendiente (decisión del usuario).** `profiles.age_confirmed_at` existe, pero `create-job` no lo exige y no hay edad fijada en la documentación («se exige edad mínima y no se procesan fotos de menores»). La app pide declarar la mayoría de edad (18 años) antes de aceptar los consentimientos `body_scan` y `color_analysis` y escribe `age_confirmed_at`. Decidir la edad y, si se quiere, comprobarla también en `create-job`.
3. **`garments.embedding` legible por la app.** **Pendiente (menor).** El contrato dice que el embedding no se sirve a la app, pero `authenticated` tiene `select` sobre toda la tabla `garments`. La app no lo pide (selecciona columnas). Si se quiere cerrar: privilegios por columna o leer siempre por la vista `garments_with_measurements`.
4. **`UploadTicket.signed_url` sin `publicUrl()`.** **Sin efecto en la nube.** `create-job` devuelve la URL firmada de subida sin pasarla por `publicUrl()` (sí lo hace `export-data`); en local apuntaría a `http://kong:8000`. La app no usa `signed_url`: sube con `storage.from("raw-uploads").uploadToSignedUrl(<ruta sin bucket>, token, bytes, { contentType })` contra la URL pública del proyecto, como indica el contrato.
5. **Rango de altura.** **Sin cambio.** El contrato admite 50–260 cm (`AvatarJobInput.height_cm`); la app valida 100–250 cm (adultos), dentro del rango. Peso: 20–350 kg, igual que el contrato.
6. **Auth sin SMTP propio.** **Pendiente (panel).** El servidor de correo por defecto de Supabase solo envía a los emails del equipo del proyecto y con un límite muy bajo por hora; con «Confirm email» activado, otras personas no pueden registrarse. Para probar, desactivar «Confirm email» (ver `apps/app/README.md`); antes de abrir la app, SMTP propio y plantillas en español.
