# Revisión crítica de la fase 0 · 2026-11-11

Alcance: `supabase/` (migraciones, RLS, Storage, Edge Functions, pg_cron), `services/workers`, `packages/contracts` y `apps/app`, en la rama `main` (`ad6fcd3`). Se han leído también `README.md`, `docs/architecture.md` (con §7) y `docs/integration-issues.md`. No se ha corregido nada.

## Resumen

**No hay hallazgos críticos.** El diseño de privacidad es serio: RLS en todas las tablas, privilegios por columna, funciones SECURITY DEFINER con `search_path = ''` y solo para `service_role`, firma HMAC con marca de tiempo verificada en tiempo constante en los dos lados, borrado de fotos en el callback con barrido de seguridad, y ningún secreto en el repositorio ni en el historial.

Hay **tres hallazgos altos**, todos de retención o de salida de datos personales:

1. **A1.** `jobs.input` y `jobs.output` guardan sin plazo copias de las medidas, la forma corporal, la altura, el peso, el género y el color de piel, pelo e iris. Esas copias sobreviven a la retirada del consentimiento y al borrado del avatar, y la exportación no las incluye. Comprobado.
2. **A2.** Al retirar el consentimiento de colorimetría se conserva el perfil de color si el usuario corrigió la estación a mano, y con él el LAB de piel, pelo e iris y el ITA. Comprobado.
3. **A3.** Modal guarda en su plano de control la entrada de cada job (URLs firmadas a la foto y datos corporales) y su resultado (medidas y perfil de color). La región elegida solo fija dónde se ejecuta el contenedor. Falta confirmar con Modal dónde viven esos datos y durante cuánto tiempo.

Además hay 8 hallazgos de gravedad media y 11 de gravedad baja.

| # | Gravedad | Tema | Estado |
|---|---|---|---|
| A1 | Alta | Copias de datos derivados en `jobs` sin plazo; sobreviven a la retirada | Comprobado (SQL) |
| A2 | Alta | Retirada de colorimetría no borra perfiles con `user_overridden` | Comprobado (SQL) |
| A3 | Alta | Entradas y resultados de los jobs retenidos por Modal, posible salida de la UE | Comprobado en código; verificar con Modal |
| M1 | Media | Prueba de consentimiento escrita por el cliente y archivo D6 que no se puede vincular a nadie | Comprobado (SQL) |
| M2 | Media | Ficheros que aparecen después de la baja o de la retirada y duran hasta ~48 h | Razonado sobre el código |
| M3 | Media | Edge Functions sin región fijada | Razonado; verificar en el despliegue |
| M4 | Media | La caché de drapeado ignora `measurements_override` | Comprobado en código |
| M5 | Media | Jobs de prenda sin consentimiento aunque las fotos pueden mostrar a la persona | Diseño |
| M6 | Media | La red de seguridad de 60 min puede fallar en silencio | Comprobado en código |
| M7 | Media | Zonas de fit sin medida corporal equivalente | Comprobado en contrato |
| M8 | Media | Sesgos: validación del avatar pequeña, escalas de piel distintas, captura solo de pie | Diseño |
| B1–B11 | Baja | Ver §3 | — |

## Cómo se ha comprobado

- **Postgres local sin Docker.** No hay daemon de Docker ni CLI de Supabase. Se levantó un PostgreSQL 16 temporal con stubs mínimos de `auth`, `storage`, `vault`, `cron` y `net`. pgvector se sustituyó por un dominio `text`. Se añadieron los privilegios por defecto que Supabase da en `public` a `anon`, `authenticated` y `service_role`. Las ocho migraciones se aplican sin errores. Sobre esa base se ejecutaron escenarios como el usuario (`set role authenticated` + `request.jwt.claim.sub`), como `service_role` y como `anon`. Las consultas clave están en el anexo. El clúster se paró al terminar.
- **Enums.** Un script compara las 23 constantes del contrato (`BODY_MODELS`, `JOB_TYPES`, `CONSENT_PURPOSES`…) con los enums de Postgres: las 23 coinciden.
- **Tests existentes, todos en verde.**
  - `uv run pytest` en `services/workers`: 49 tests.
  - `npm run check`: contratos y `tsc` de la app.
  - `deno check` de las 5 Edge Functions y de `tests/unit/hmac.test.ts`.
  - `deno test` del vector de firma: 2 tests.
  - No se pudieron ejecutar los pgTAP ni el e2e, porque necesitan el stack de Supabase.
- **Secretos.** Se revisó `git log --all -p` con patrones de JWT, `sb_secret_`, `sk_`, AWS, claves PEM, `ghp_` y `SECRET=…`, más la lista de ficheros `.env` y `.temp` del historial. Solo existe `supabase/functions/.env.example`, sin valores. Los secretos de los tests son literales de prueba evidentes.
- **Licencias.** Se recorrieron el `package-lock.json` (≈610 paquetes) y el `.venv` de los workers. No hay ninguna licencia GPL, AGPL ni no comercial que obligue. El detalle está en B9.

---

## 1. Hallazgos altos

### A1 · Alta · Copias de medidas, forma y color de piel en `jobs` sin plazo, que sobreviven a la retirada y al borrado del avatar

**Dónde**
- `supabase/migrations/20261111000500_job_queue.sql:231` (`v_output := p_output`) y `:376`: `complete_job` copia la salida entera del worker en `jobs.output`. Para un avatar es el `Avatar` completo (`measurements`, `shape`, `measurements_sigma_cm`); para colorimetría, el `ColorProfile` completo (`skin_lab`, `hair_lab`, `eye_lab`, `ita`, `skin_hue_deg`). Solo se quita el embedding de las prendas.
- `supabase/migrations/20261111000200_core_tables.sql:355-356`: `jobs.input` guarda `height_cm`, `weight_kg` y `gender` (`AvatarJobInput`, `packages/contracts/src/index.ts:964`).
- `supabase/migrations/20261111000500_job_queue.sql:584-615`: `on_consent_withdrawn` borra `avatars` y `color_profiles`, pero no toca `jobs`. Ninguna migración ni tarea de pg_cron borra filas de `jobs`.
- `supabase/functions/export-data/index.ts:36` y `:46`: la exportación omite `jobs.output` («los resultados están en las demás secciones»). Después de una retirada eso deja de ser cierto.

**Por qué importa.** `docs/architecture.md:268` dice que «retirar un consentimiento borra los datos derivados de él». Hoy esos datos quedan en `jobs` mientras exista la cuenta, el usuario sigue leyéndolos por RLS y la exportación no se los muestra:
- choca con la limitación del plazo de conservación (art. 5.1.e);
- choca con el efecto de la retirada (art. 7.3, unido al 17.1.b);
- deja incompleta la respuesta de acceso (art. 15).

El peso y el género no tienen otro sitio en el esquema: solo viven en `jobs.input`.

**Cómo se comprobó.** En el Postgres local:
1. Se cerró con `complete_job` un job `avatar` y otro `color`.
2. Como el usuario, se retiraron `body_scan` y `color_analysis`.
3. Resultado: `avatars` queda vacío, pero `jobs` sigue devolviendo `input.height_cm = 171`, `output.avatar.measurements` (pecho 98,5, cintura 84,2, cadera 101,3…), `output.avatar.shape.params` y `output.color_profile.skin_lab`. Ver el anexo, escenario 1.

**Arreglo propuesto**
- No persistir en `jobs.output` el objeto de dominio. Guardar solo referencias, por ejemplo `{ avatar_id }`, `{ color_profile_id }` o `{ garment_id }`, y el `fit_result_id`. Así la app sigue sabiendo qué se creó.
- Minimizar `jobs.input` al cerrar el job (`input := input - 'height_cm' - 'weight_kg' - 'gender'`, o quedarse solo con los identificadores). Si el peso y el género sirven para reajustar la forma, deben estar en `avatars` y no en la cola.
- Añadir una purga de `jobs` terminados (por ejemplo, a los 30–90 días) a `maintenance-daily`.
- En `on_consent_withdrawn`, vaciar `input` y `output` de los jobs del tratamiento retirado.
- Añadir un pgTAP que compruebe que, tras la retirada, no queda ninguna medida en `jobs`.

### A2 · Alta · La retirada de la colorimetría conserva el color de piel, pelo e iris si el usuario corrigió la estación

**Dónde**
- `supabase/migrations/20261111000500_job_queue.sql:605`: `delete from public.color_profiles where user_id = new.user_id and not user_overridden;`.
- `supabase/migrations/20261111000300_rls.sql:83-84`: la app puede poner `user_overridden = true` y elegir `season`, `undertone` y demás.

**Por qué importa.** Corregir la estación a mano no convierte `skin_lab`, `hair_lab`, `eye_lab`, `ita` ni `skin_hue_deg` en datos introducidos por el usuario. Siguen saliendo del selfie, y `color.md` §8 los trata como dato sensible. Tras la retirada el perfil entero se conserva sin base legal.

**Cómo se comprobó.** Escenario 2 del anexo:
1. Se crea un perfil de color por `complete_job`.
2. Como el usuario: `update color_profiles set season='deep_autumn', user_overridden=true`.
3. Se retira `color_analysis`.
4. Resultado: la fila sigue, con `skin_lab {l:62.1,a:14.3,b:18.9}`, `eye_lab`, `hair_lab` e `ita 21.7`.

**Arreglo propuesto.** Separar lo elegido de lo medido. Al retirar el consentimiento:
- si `user_overridden`, conservar solo los campos elegidos (`season`, `undertone`, `value`, `intensity`, `contrast`, `palettes`, `metal`) y poner a `null` `skin_lab`, `hair_lab`, `eye_lab`, `ita`, `skin_hue_deg`, `scores`, `quality` y `alternatives`. Eso exige que esas columnas admitan `null`;
- o borrar la fila y crear una nueva con origen manual.

Hay que añadir el caso al pgTAP de retirada. Para `body_scan` el filtro `measurements_source <> 'manual'` es correcto, siempre que un avatar de foto nunca pueda pasar a `manual`; hoy la app no puede escribir esa columna.

### A3 · Alta (pendiente de verificar con el proveedor) · Modal guarda entradas y resultados de los jobs fuera del contenedor en región UE

**Dónde**
- `services/workers/modal_app.py:77`: `RUNNERS[data["type"]].spawn(data)`. El `JobDispatch` completo pasa por la cola de Modal. Incluye:
  - `input_urls`: URLs firmadas de 15 min a la foto de cuerpo o al selfie;
  - `user_id`, `height_cm`, `weight_kg` y `gender`;
  - en el drapeado, las medidas efectivas del cuerpo.
- `services/workers/modal_app.py:52`: `return execute_http(...)` devuelve el callback final con el `output`, es decir, el avatar con medidas y forma o el perfil de color. Modal guarda ese valor como resultado de la llamada lanzada con `spawn`.
- `modal_app.py:21` marca la región como «(verificar)».

**Por qué importa.** El parámetro `region=` de Modal fija dónde corre el contenedor, no dónde se guardan las entradas y salidas de las funciones ni los logs. Si el plano de control está fuera de la UE, hay una transferencia internacional de datos de salud o biométricos en sentido amplio. Además, la URL firmada permite descargar la foto mientras no caduque. Aunque todo estuviera en la UE, retener el resultado en el proveedor contradice «ninguna copia fuera del bucket efímero» (§4) y es innecesario, porque el resultado ya viaja por callback.

**Cómo se comprobó.** Leyendo el código; no hay cuenta de Modal en esta sesión. La retención de entradas y resultados en Modal se describe de memoria y hay que confirmarla con su documentación y su contrato de encargo.

**Arreglo propuesto**
- Que `run` devuelva `None`, o solo `{job_id, attempt, status}`.
- Pasar a la función GPU lo mínimo y sacar del payload lo que no necesita, como el peso o el género, si el pipeline no los usa.
- Pedir a Modal por escrito la ubicación de su plano de control, de la cola de entradas, del almacén de resultados y de los logs, y su retención. Si no garantiza la UE, activar ya la alternativa prevista (RunPod con centro de datos en la UE) o una cola propia en la que Modal solo reciba un `job_id` y descargue el despacho firmado desde la API.
- Añadirlo como punto bloqueante a la EIPD.

---

## 2. Hallazgos medios

### M1 · Media · La prueba de consentimiento la escribe el cliente y el archivo D6 no se puede vincular a quien reclama

**Dónde**
- `supabase/migrations/20261111000300_rls.sql:52` y `:57-59`: `grant select, insert on public.consents` sobre todas las columnas. La política solo exige `user_id = auth.uid()` y `withdrawn_at is null`.
- `supabase/migrations/20261111000200_core_tables.sql:64-65`: `granted_at` y `created_at` solo tienen un `default`, así que el cliente puede enviar el valor que quiera.
- `supabase/migrations/20261111000700_consent_archive.sql:82` y `:112`: el archivo guarda `HMAC(secreto, user_id)` y copia `granted_at` y `text_version` tal cual.

**Por qué importa.** D6 existe para poder demostrar el consentimiento (art. 7.1). Eso falla por dos lados:
1. **La fecha y el texto los pone el cliente.** Cualquier cliente (o una app con un fallo) puede registrar un consentimiento con fecha retroactiva y una versión de texto que no existe, y eso pasa al archivo «bloqueado» como prueba.
2. **El seudónimo no se puede recalcular.** Tras la baja el `user_id` desaparece de Auth, y quien reclama no lo conoce. Para encontrar su registro habría que conservar el `user_id` en otro sitio, y entonces deja de estar seudonimizado; hoy solo queda en los logs (B7). Tal como está, el archivo cumple el plazo pero no sirve para vincular un registro a nadie.

**Cómo se comprobó.** Escenario 3 del anexo:
- como `authenticated` se insertó `('body_scan', 'lo-que-sea', granted_at '2020-01-01', created_at '2020-01-01')` y se aceptó;
- tras la baja, el archivo contiene esa fila con `granted_at 2020-01-01`.

**Arreglo propuesto**
- Dar al cliente solo `grant insert (purpose, text_version)`, más un trigger que fuerce `granted_at = now()` y `created_at = now()`.
- Validar `text_version` contra una tabla `consent_texts(purpose, version, sha256_del_texto)` publicada por la API.
- En el archivo, guardar además el HMAC del email normalizado, que es lo que aportará quien reclame, con el mismo secreto o con otro.
- Que un abogado confirme qué identificador es aceptable. El riesgo ya figura como pendiente en `integration-issues.md`.

### M2 · Media · Ficheros que aparecen después de la baja o de la retirada y duran hasta ~48 h

**Dónde**
- `supabase/functions/delete-account/index.ts:51-66`: vacía Storage y borra el usuario, pero no cancela antes los jobs en curso.
- `supabase/functions/_shared/dispatch.ts:138`: el worker tiene URLs firmadas de subida de 2 h a `assets/<uid>/…`.
- `supabase/migrations/20261111000500_job_queue.sql:524-536`: `orphaned_assets` solo recoge objetos con más de 1 día, y `20261111000600_cron.sql:57` la ejecuta una vez al día.

**Por qué importa**
- **Baja con un job en curso.** Si un usuario se da de baja con un avatar o un drapeado en marcha, el worker sube el GLB del cuerpo a la carpeta del usuario ya borrado, y su callback recibe 404. El fichero queda huérfano hasta el primer `gc_assets` en que tenga más de 24 h, es decir, entre 24 y 48 h. `user_storage_objects` ya no lo encuentra, porque la baja terminó.
- **Retirada del consentimiento.** El GLB del avatar borrado sigue legible por el usuario (`assets_select_own`) y existe hasta ~48 h.
- Es un caso acotado, pero contradice «borrado total».

**Cómo se comprobó.** Leyendo el código, sin ejecutarlo.

**Arreglo propuesto**
- En `delete-account`, antes de vaciar Storage, marcar `canceled` los jobs `queued` y `running` del usuario y esperar a que venza el plazo, o rechazar la baja con 409 mientras haya jobs en curso.
- Tras borrar el usuario, dejar en una tabla interna `deleted_user_folders(user_id, until)` el prefijo de sus carpetas para que `maintenance` lo barra cada minuto durante 2 h. Guardar ese `user_id` unas horas es una conservación mínima y justificable.
- Para la retirada del consentimiento, borrar los ficheros del avatar en el mismo flujo (pg_net → `maintenance`) en lugar de esperar a la recogida de huérfanos.
- Bajar `p_min_age` de `orphaned_assets` a ~2 h, que es la vida de la URL de subida.

### M3 · Media (verificar en el despliegue) · Las Edge Functions no tienen región fijada

**Dónde.** `docs/architecture.md` §4 («Región UE») y `supabase/config.toml:406-424`. Ni la configuración ni el código fijan región de ejecución para las funciones. `create-job`, `job-callback` y `export-data` procesan medidas, URLs firmadas a fotos y la exportación completa.

**Por qué importa.** Por defecto Supabase ejecuta las Edge Functions en la región más cercana a quien llama, no necesariamente en la del proyecto. Un usuario de viaje, o un worker que llama desde fuera de la UE, hace que esos datos se procesen fuera de la UE. Es un dato del proveedor que hay que verificar, igual que en A3.

**Arreglo propuesto**
- Confirmar el comportamiento en el proyecto en la nube cuando exista.
- Fijar la región de ejecución en una de la UE, con la cabecera o la opción de región de invocación que ofrezca Supabase, en la app, en `pg_net` y en el `callback_url`.
- Añadirlo a la lista de subencargados de la EIPD.

### M4 · Media · La clave de caché del drapeado ignora las medidas corregidas por el usuario

**Dónde**
- `supabase/functions/create-job/index.ts:115-126`: la clave usa `avatar.shape_hash`.
- `supabase/functions/_shared/dispatch.ts:98`: el simulador recibe `measurements` con `measurements_override` aplicado.
- Nada actualiza `shape_hash` cuando cambia el override. La app solo puede escribir `measurements_override` (`20261111000300_rls.sql:69`).

**Por qué importa.** Si el usuario corrige la cintura, que es justo la red de seguridad contra el error de más de 3 cm de `avatar.md`, el siguiente drapeado de la misma prenda y talla acierta en la caché y devuelve el GLB y el `FitResult` calculados con las medidas antiguas. Eso contradice el contrato: «`shape_hash` cambia cuando cambia la forma» (`packages/contracts/src/index.ts`, `Avatar.shape_hash`).

**Cómo se comprobó.** Leyendo el código: `measurements_override` no aparece en el cálculo de la clave, y no hay ningún trigger sobre `shape_hash`.

**Arreglo propuesto**
- Incluir en el material de la clave un hash canónico de las medidas efectivas, o recalcular `shape_hash` con un trigger al cambiar `measurements_override`.
- Invalidar `drape_cache` del avatar en ese mismo trigger.
- De paso, usar como versión de la prenda `pipeline_version` más un hash de `attributes` en lugar de `updated_at`. Hoy renombrar una prenda invalida su caché y cuesta GPU.

### M5 · Media · Los jobs de prenda no piden consentimiento y el recorte se guarda sin comprobar que no queda la persona

**Dónde**
- `supabase/functions/create-job/index.ts:36` y `:51-52`: solo `avatar` y `color` exigen consentimiento.
- `docs/architecture.md:214`: «el worker segmenta la prenda (quita fondo y persona)».
- `garments.image_path` se conserva hasta el borrado.

**Por qué importa**
- La arquitectura asume que las fotos de prenda pueden mostrar a la persona que la lleva, por ejemplo en una foto de espejo, posiblemente con la cara. Esas fotos van a GPU sin un consentimiento propio ni un aviso.
- Si la segmentación falla, el recorte con piel o cara queda guardado indefinidamente en `assets/<uid>/garments/`.
- Es más leve que el escaneo corporal, pero entra en el mismo análisis.

**Arreglo propuesto**
- Pedir en la captura de prendas que la prenda esté extendida o en percha (`fit.md` ya propone una foto cenital con folio).
- Si se admiten fotos puestas, declararlo en la información y en la EIPD.
- Añadir un control en el worker: si el recorte contiene piel o cara (MediaPipe ya está en el stack), rechazar el job con un código propio y no subir el recorte.

### M6 · Media · La red de seguridad de 60 minutos puede fallar en silencio

**Dónde**
- `supabase/migrations/20261111000600_cron.sql:31-35`: sin los secretos de Vault, `invoke_maintenance` solo emite un `raise warning`.
- La respuesta de `pg_net` (`net._http_response`) no se revisa.
- `supabase/functions/maintenance/index.ts:81-88`: los fallos de tarea se registran, pero nada avisa.
- `docs/architecture.md:321` exige «Consulta programada con alerta: siempre 0».

**Por qué importa.** Si falla el callback y falta la configuración, porque el entorno es nuevo, se rotó el secreto o la función no está desplegada, las fotos de los jobs que expiran o fallan sin callback se quedan sin límite. Nadie se entera.

**Arreglo propuesto**
- Una consulta programada en SQL, sin pasar por HTTP: `select count(*) from storage.objects where bucket_id='raw-uploads' and created_at < now() - interval '75 minutes'`. Si da más que cero, una alerta por el canal que se elija (pg_net a un webhook o un monitor externo).
- Cambiar el `raise warning` por un registro en una tabla de incidencias.
- Que `create-job` rechace los escaneos (503) si esa comprobación está en rojo, como dice la propia arquitectura.

### M7 · Media · Zonas de fit sin medida corporal equivalente

**Dónde.** `packages/contracts/src/index.ts`:
- `FIT_ZONES` (`:432-447`) incluye `knee`, `rise` y `hem`;
- `ANCHOR_FIT_ZONES` (`:459-465`) incluye `cuff` y `body_length`;
- `BodyMeasurements` (`:142-170`) no tiene `knee_cm` ni `rise_cm`, y `wrist_cm` y `torso_length_cm` son opcionales;
- no hay ninguna tabla que diga qué medida corporal corresponde a cada zona, por ejemplo `shoulder` → `shoulder_width_cm` o `sleeve_length` → `arm_length_cm`.

**Por qué importa**
- `ZoneFit` necesita `body_cm` por zona. Para `knee` y `rise` no existe medida corporal en el contrato, aunque `fit.md:34` las usa en pantalones y `avatar.md:64` propone que el usuario corrija el tiro.
- Dos zonas ancla, `cuff` y `body_length`, dependen de medidas que el estimador puede no dar.
- El riesgo es que el worker de fit y la app inventen cada uno su propio mapeo. Es la deriva que D5 quería evitar.

**Arreglo propuesto**
- Añadir al contrato `FIT_ZONE_BODY_MEASUREMENT: Record<FitZone, BodyMeasurementKey | null>`.
- Añadir `knee_cm` y `rise_cm` a `BodyMeasurements`.
- Documentar qué hace el fit cuando falta la medida de una zona ancla: veredicto `null` y confianza baja.

### M8 · Media · Sesgos de tono de piel y de tipo de cuerpo en el diseño

**Dónde**
- `docs/research/avatar.md:79`: el conjunto de validación del avatar es de 30–40 voluntarios, equilibrado a la vez en sexo, tres tramos de IMC y Fitzpatrick I–VI.
- `docs/research/color.md:137` y `:201`: la colorimetría usa la escala Monk con 15 personas por tono como mínimo.
- §1.4 y §3.4 de la arquitectura: la captura exige una persona de pie, de cuerpo entero y en A-pose.
- `supabase/migrations/20261111000200_core_tables.sql`, `avatars.measurements`: exige siete medidas, incluidos los dos brazos y la entrepierna.

**Por qué importa**
- Con 30–40 personas y unas 36 celdas (2 × 3 × 6) quedan una o dos personas por celda. No se puede afirmar «error < 3 cm en todos los tonos de piel y tallas», que es la regla del README («Validar con todos los tonos de piel y tipos de cuerpo»). `avatar.md:114` ya reconoce que los estimadores fallan más en cuerpos grandes.
- Usar Fitzpatrick en el avatar y Monk en el color impide cruzar resultados.
- Quien no puede mantenerse de pie en A-pose (usuarios de silla de ruedas) o tiene una diferencia en un miembro no puede tener avatar por foto. Tampoco puede guardarlo con medidas manuales si le faltan medidas obligatorias.
- La colorimetría está mejor tratada (`color.md` §6 tiene mitigaciones concretas para piel oscura). Su punto débil es que el segmentador tiene 71,9 de IoU en el peor grupo y no hay umbral que bloquee el lanzamiento.

**Arreglo propuesto**
- Dimensionar la validación del avatar por estrato, por ejemplo al menos 10–15 personas por tramo de tono (agrupando MST 1–3, 4–6 y 7–10) y por tramo de IMC, y analizar cada eje por separado.
- Usar la escala Monk en los dos estudios.
- Fijar criterios de lanzamiento por grupo («MAE del peor grupo ≤ 1,5 × MAE global») en `phase0-plan.md`.
- Admitir una pose sentada o una foto asistida como camino alternativo.
- Hacer opcionales las medidas de miembros en `avatars.measurements`, con el fit tratando la ausencia.

---

## 3. Hallazgos bajos

### B1 · Baja · `service_role` puede vaciar el archivo de consentimientos, aunque el comentario dice lo contrario

- **Dónde:** `supabase/migrations/20261111000700_consent_archive.sql:128-129` («ni service_role puede borrar del archivo») y `:147`. Se revoca a `public`, `anon` y `authenticated`, pero no a `service_role`, que en Supabase recibe EXECUTE por los privilegios por defecto de `public`. La función es SECURITY DEFINER y acepta cualquier intervalo.
- **Cómo se comprobó:** `has_function_privilege('service_role', 'public.purge_consent_archive(interval)', 'execute') = true`. Como `service_role`, `select public.purge_consent_archive('0 seconds')` borró los 3 registros archivados (escenario 5).
- **Por qué importa poco:** quien tiene la clave de servicio ya lo puede casi todo, pero el comentario y D6 prometen un bloqueo que no existe.
- **Arreglo:** `revoke execute … from service_role`, o mover la función a `private` y fijar el intervalo dentro sin parámetro.

### B2 · Baja · La app escribe columnas que deberían ser del pipeline o estar validadas

- **Dónde:** `supabase/migrations/20261111000300_rls.sql:104`, `garments.status` es escribible.
- **Dónde:** `:69`, `avatars.measurements_override` admite cualquier objeto.
- **Cómo se comprobó:** como el usuario, `update garments set status='failed'` funcionó. También funcionó `update avatars set measurements_override='{"chest_cm":-40,"waist_cm":"abc","x":{"y":1}}'`.
- **Por qué importa:** ese override pasa a `DrapeJobContext.avatar.measurements` (`dispatch.ts:98`), no valida contra `JobDispatch` y hace que todo drapeado de ese avatar gaste sus intentos y termine en `internal`. Solo afecta al propio usuario.
- **Arreglo:** quitar `status` del grant de `garments`, o limitar los valores con un trigger, y añadir un `check` o trigger que valide `measurements_override`: solo claves de `BodyMeasurements`, números y rangos plausibles.

### B3 · Baja · Defensa contra SSRF incompleta en los workers

- **Dónde:** `services/workers/src/probador_workers/http_client.py:34` y `config.py:58-65`. Si `PROBADOR_ALLOWED_URL_HOSTS` está vacío se acepta cualquier host `https`, y producción no lo exige. Tampoco se rechazan IP privadas ni de enlace local.
- **Por qué importa poco:** el `JobDispatch` va firmado, así que explotarlo exige el secreto de despacho.
- **Arreglo:** exigir la lista de hosts en `production` (el host del proyecto de Supabase) y rechazar IP literales y rangos privados.

### B4 · Baja · Reenvío del despacho y plazos desalineados

- **Dónde:** `modal_app.py:45` (`timeout=15 * 60`) frente a `private.job_timeout` de 10 min (`20261111000500_job_queue.sql:14-26`). Además, el worker no deduplica por `job_id` y `attempt`.
- **Por qué importa:**
  - Un despacho capturado se puede reenviar durante 300 s y lanza otra ejecución en GPU que vuelve a descargar la foto (coste y una copia más en memoria).
  - Un job de más de 10 min se vuelve a despachar mientras el intento anterior sigue corriendo, porque Modal lo deja llegar a 15 min.
  - La arquitectura (§3.1) dice que las dos peticiones son idempotentes; en el worker no lo son.
- **Arreglo:** deduplicar en el endpoint `dispatch` con un `modal.Dict` por `job_id` y `attempt` que viva 10 min, y alinear el timeout de Modal con el plazo de la API (≤ 10 min).

### B5 · Baja · La URL firmada de subida vuelve a servir cuando se borra la foto

- **Dónde:** `supabase/functions/create-job/index.ts:186` y D8 (`docs/architecture.md:385`, «cada ruta admite una sola subida»).
- **Por qué importa:** sin `upsert`, el token de subida solo falla mientras el objeto existe. En cuanto el callback borra la foto, la misma URL sigue valiendo hasta que se cumplen sus 2 h y admite otra subida a esa ruta. El barrido de 60 min acota el daño, pero la mitigación de D8 está descrita de más.
- **Cómo se comprobó:** razonando sobre el funcionamiento de las URLs firmadas de Storage, sin ejecutarlo. Se puede confirmar con un caso más en el e2e: subir, borrar y volver a subir con el mismo token.
- **Arreglo:** usar nombres de fichero de raw-uploads elegidos por la API (`<uid>/<job_id>-<n>.jpg`), no por el cliente, y rechazar en `create-job/uploaded` cualquier objeto cuyo `created_at` sea posterior al cierre del job. O corregir el texto de D8.

### B6 · Baja · Validación de entradas incoherente entre la app y la API

- **Dónde:** `apps/app/src/lib/height.ts:2-3` limita la altura a 100–250 cm. El contrato solo exige `minimum: 0` (`Centimeters`), así que la API acepta `height_cm: 0` o `9999`.
- **Dónde:** `size_label` y `brand` (`GarmentJobInput` y `DrapeJobInput`) no tienen longitud máxima, y la columna `garments.size_label` tampoco.
- **Arreglo:** `@minimum 50` y `@maximum 260` en `AvatarJobInput.height_cm` y `weight_kg`, y `@maxLength 32` o `80` en las cadenas libres.

### B7 · Baja · `delete-account` deja el `user_id` en los logs después de la baja

- **Dónde:** `supabase/functions/delete-account/index.ts:60` y `:68`.
- **Por qué importa:** es poco, porque el `user_id` es un identificador aleatorio. Pero es el único sitio donde sobrevive y, junto con el secreto de Vault, permite vincular un registro del archivo D6 a ese `user_id` fuera del proceso bloqueado (ver M1).
- **Arreglo:** registrar el HMAC o un identificador de la petición, no el `user_id`, o documentar la retención de los logs del proveedor.

### B8 · Baja · La cuota de jobs no es atómica

- **Dónde:** `supabase/functions/create-job/index.ts:67-78`: cuenta y después inserta.
- **Por qué importa:** peticiones concurrentes superan `JOB_DAILY_QUOTA`. Es una cuestión de coste, no de privacidad. La de exportaciones sí usa un bloqueo consultivo (`register_data_export`).
- **Arreglo:** el mismo patrón que la exportación: una RPC con `pg_advisory_xact_lock` que cuente e inserte en una sola transacción.

### B9 · Baja · Licencias: dependencias limpias, quedan modelos sin revisar

- **Dependencias.** Todas las de npm son MIT, ISC, Apache-2.0 o BSD, con estas salvedades, ninguna problemática para uso comercial:
  - `lightningcss` es MPL-2.0 y solo se usa al compilar;
  - `node-forge` es «BSD-3-Clause OR GPL-2.0», y se elige la BSD;
  - un paquete CC-BY-4.0 (probablemente `caniuse-lite`) solo exige atribución.
- **Python.** httpx, jsonschema (con `format-nongpl`, bien elegido), fastapi, uvicorn y pydantic tienen licencias permisivas.
- **Embedding sin revisar.** El modelo del embedding (`fashion-clip-vit-b32`, en el contrato y en `20261111000200_core_tables.sql`) no aparece en ninguna tabla de licencias de `docs/research`. Hay que revisar la licencia de los pesos y el origen de los datos de FashionCLIP, o de la variante de OpenCLIP que se elija.
- **Backbone de SAM 3D Body.** El backbone DINOv3 que usa uno de los checkpoints de SAM 3D Body puede tener su propia licencia de Meta. Conviene que la revisión legal de la SAM License, que ya está prevista, la incluya.
- **`smplx` sin guarda.** `body_model` admite `smplx` en la base de datos sin ninguna guarda, así que un avatar SMPL-X podría llegar a producción. Bastaría con que `complete_job` lo rechace mientras no exista licencia.

### B10 · Baja · Un fichero ignorado sigue versionado

- **Dónde:** `supabase/.branches/_current_branch`. Está en `.gitignore`, pero se versionó antes de añadir la regla.
- **Por qué importa:** solo contiene `main` y no es un secreto. Conviene sacarlo del índice para que nadie dé por hecho que lo ignorado no está en el repositorio.

### B11 · Baja · El embedding se presenta como interno pero el usuario puede leerlo

- **Dónde:** `20261111000200_core_tables.sql:208-212`, comentario de `embedding` («no se sirve a la app»), frente al `grant select on public.garments` de la tabla entera (`20261111000300_rls.sql:103`). El usuario puede leer el embedding de sus prendas.
- **Exportación:** `export-data` no lo incluye.
- **Por qué importa poco:** no es un riesgo, porque es un dato suyo. Es una incoherencia: o se excluye por privilegio de columna o se exporta.

---

## 4. Lo que se revisó y está bien

- **RLS entre usuarios.** Con un segundo usuario, `jobs`, `avatars` y `consents` del primero dan 0 filas. `anon` recibe «permission denied» en `consent_records_archive`. `job_runs` y `data_export_requests` no tienen privilegios para la app.
- **Funciones.** Las 25 funciones de `public` y `private` tienen `search_path = ''`. Las SECURITY DEFINER de `public` solo las ejecuta `service_role`, y las de `private` ninguno de los roles de la Data API.
- **`complete_job`.** Comprueba el dueño (`user_id`), el `attempt`, el `cache_key` y que las rutas de salida estén entre las emitidas para el intento. Un worker no puede apuntar a ficheros de otro usuario.
- **Firma HMAC.**
  - Los dos lados usan el mismo vector y comparan en tiempo constante.
  - Se rechazan las marcas de tiempo con más de 300 s de desfase.
  - El callback se verifica sobre el cuerpo exacto antes de parsearlo.
  - Los reenvíos de un callback terminal responden `already_terminal`.
- **Borrado de fotos.**
  - El borrado sigue tres caminos:
    1. el callback borra antes de cerrar el job y responde 503 si no puede;
    2. `delete_job_inputs` recoge los jobs cancelados o caducados;
    3. el barrido de 60 min borra todo lo demás.
  - La retirada del consentimiento cancela los jobs, y sus fotos entran en el camino 2.
- **Logs.**
  - El worker solo registra campos escalares con nombre permitido, tapa las URLs, no registra el mensaje de las excepciones y silencia httpx.
  - Las Edge Functions solo registran recuentos y `job_id`.
- **Exportación.**
  - Lee con el JWT del usuario y filtra además por su `user_id`.
  - Solo firma rutas de `assets/<uid>/`.
  - Valida la respuesta contra su esquema antes de enviarla y no registra valores.
- **Contratos y SQL.** Los 23 enums coinciden. Los esquemas de entrada de los jobs tienen `additionalProperties: false`, de modo que la app no puede meter campos extra en `jobs.input`.
- **Secretos.** No hay ninguno en el repositorio ni en el historial.

## Anexo · Consultas de comprobación

Base de datos: PostgreSQL 16 local con las ocho migraciones aplicadas, más:
- stubs de `auth.users` y `auth.uid()` (que lee `request.jwt.claim.sub`);
- stubs de `storage.objects` y `storage.foldername`;
- `vault.decrypted_secrets`, `cron.schedule` y `net.http_post`;
- los privilegios por defecto de Supabase en `public`.

```sql
-- Escenario 1 y 2 (A1, A2): se cierra un job avatar y otro color con complete_job(...),
-- luego, como el propio usuario:
set role authenticated; set request.jwt.claim.sub = '<uid A>';
update public.color_profiles set season = 'deep_autumn', user_overridden = true;
update public.consents set withdrawn_at = now() where purpose in ('body_scan', 'color_analysis');
select count(*) from public.avatars;                                   -- 0
select skin_lab, eye_lab, hair_lab, ita from public.color_profiles;    -- sigue la fila (A2)
select input ->> 'height_cm', output -> 'avatar' -> 'measurements',
       output -> 'avatar' -> 'shape', output -> 'color_profile' -> 'skin_lab'
  from public.jobs;                                                    -- todo sigue (A1)

-- Escenario 3 (M1): consentimiento con fecha retroactiva y texto inventado, aceptado.
insert into public.consents (purpose, text_version, granted_at, created_at)
  values ('body_scan', 'lo-que-sea', '2020-01-01', '2020-01-01');

-- Escenario 4 (B2): ambas sentencias se aceptan.
update public.garments set status = 'failed' where id = '<prenda en processing>';
update public.avatars set measurements_override = '{"chest_cm": -40, "waist_cm": "abc"}';

-- Escenario 5 (B1): tras borrar el usuario de auth.users, el archivo tiene 3 filas…
set role service_role;
select public.purge_consent_archive(interval '0 seconds');             -- 3 borradas
```
