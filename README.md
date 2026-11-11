# Probador virtual 3D

App de moda: el usuario se escanea con una foto de cuerpo entero (avatar 3D con medidas reales), sube su ropa (prendas 3D), combina outfits sobre su avatar y recibe recomendaciones de tiendas según talla, fit preferido y colorimetría.

**Plataformas:** web, Android e iOS desde un único código (Expo + React Native + React Three Fiber).

Plan completo: https://claude.ai/artifact/NTjptmfYWP4XQUwfVG3m5C
Resumen del plan: `.claude/skills/probador-3d-multiagente/references/proyecto.md`

## Estructura del monorepo

| Carpeta | Contenido |
|---|---|
| `apps/app` | App Expo (web, Android, iOS) |
| `packages/contracts` | Tipos y esquemas compartidos (TypeScript + JSON Schema) |
| `services/workers` | Workers GPU (Python, uv): avatar, prenda, drapeado, color |
| `supabase/` | Backend: migraciones, RLS, Storage y Edge Functions (la API) |
| `docs/` | Arquitectura, registro de decisiones (`docs/architecture.md` §7) e investigación de la fase 0 |

Lo que es JavaScript/TypeScript se instala desde la raíz con npm workspaces (`npm install`; un único `package-lock.json`). Comprobaciones: `npm run check` (contratos y tipos de la app), `uv run pytest` en `services/workers`, y las de `supabase/README.md`.

## Reglas del proyecto

- Privacidad (RGPD): las fotos de cuerpo y cara se borran tras procesarlas; solo se guardan valores calculados. Servidores en la UE, consentimiento explícito, borrado total.
- Licencias: comprobar la licencia comercial de cada modelo o dataset.
- El avatar no depende de la topología del modelo corporal: es un GLB con medidas, más el nombre y la versión del modelo (MHR en la fase 0; SMPL-X no es comercial). Las prendas son patrones de GarmentCode, el drapeado se simula con Newton/Warp y el 3D viaja en glTF/GLB.
- Validar con todos los tonos de piel y tipos de cuerpo.
