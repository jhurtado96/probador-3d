# Problemas de integración tras la primera tanda

Recopilados de los informes de los agentes. Fuente para la reconciliación.

## A. Decisiones de investigación que cambian la arquitectura

1. **Avatar sin depender de SMPL-X** (`docs/research/avatar.md`): SMPL-X no es comercial; propuesta SAM 3D Body → MHR + ajuste de forma propio, medidas ISO 8559-1 con port de SMPL-Anthropometry (MIT). Contrato del avatar independiente de topología (GLB + medidas + nombre del modelo corporal), SOMA-X como posible adaptador. Hoy `docs/architecture.md`, `README.md`, la skill y `packages/contracts` asumen SMPL-X (con `body_model: "anny"` como alternativa).
2. **Prendas como patrón GarmentCode** y **drapeado con Newton/Warp** (`garment.md`, `drape.md`): el drapeado necesita el GLB/patrón de la prenda y el cuerpo.
3. **Face parsing**: SegFormer/BiSeNet con pesos CelebAMask-HQ no son comerciales; usar MediaPipe (`color.md`).
4. **ColorProfile**: `color.md` propone su propio tipo (se escribió con contracts vacío). Alinear con `packages/contracts`.
5. **Fit**: `fit.md` separa fit de diseño y fit en la persona, con incertidumbre por zona; revisar que `Garment`/`FitResult` lo soporten.

## B. Huecos en contratos (workers, `services/workers`)

6. Firma HMAC sin especificar: implementado `sha256=<hex>` sobre cuerpo crudo en `x-probador-signature`, sin timestamp.
7. Autenticación del dispatch entrante no definida: el worker usa HMAC con `PROBADOR_DISPATCH_SECRET`; el backend usa `WORKER_DISPATCH_TOKEN`. Unificar.
8. `JobDispatch` no lleva `user_id`, pero las salidas lo exigen.
9. `DrapeJobInput` solo trae ids: faltan GLB de avatar y prenda (el backend los pasa en `input_urls`), y medidas/parámetros.
10. `JobErrorCode` sin `not_implemented` ni `quota_exceeded`.
11. `input_deleted_at` obligatorio en la salida del worker, pero el borrado lo hace la API: debería ser opcional/propiedad de la API.
12. No hay marca estándar de salida falsa (modo fake).
13. Descripción de `Url` ("https") inconsistente con `storage://<ruta>` en callbacks; confirmar PUT para subidas.
14. `measurements_source` sin valor "no medido".

## C. Huecos en contratos (backend, `supabase/`)

15. Faltan tipos: `Consent`, `UserFitPreferences`, `DrapeCache`, `Profile`.
16. No hay forma de error de API (backend usa `{error:{code,message,details?}}`).
17. `*_url` en contrato frente a `*_path` en BD: documentar el mapeo o renombrar.
18. `Garment` en `processing` exige campos que aún no existen.
19. `Garment` no transporta el embedding (worker no puede enviarlo).
20. `Outfit.avatar_id` obligatorio en contrato, anulable en BD.
21. `FitResult` sin `user_id` (RLS va por el dueño del avatar).
22. `ColorProfile` sin `updated_at`.
23. Buckets: arquitectura dice avatars/garments/drapes; el backend usa `raw-uploads` + `assets` con carpetas.
24. URLs firmadas de subida de Supabase caducan a las 2 h, no 15 min.
25. Despliegue de Edge Functions: confirmar que el empaquetado incluye `packages/contracts`.

## D. Monorepo

26. No hay `package.json` raíz con workspaces; `packages/contracts` y `apps/app` instalados por separado (lockfiles sueltos).
27. `apps/app/.claude/settings.json` activa el plugin de Expo (decisión del usuario pendiente: no tocar).
