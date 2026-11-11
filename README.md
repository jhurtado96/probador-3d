# Probador virtual 3D

App de moda: el usuario se escanea con una foto de cuerpo entero (avatar 3D SMPL-X con medidas reales), sube su ropa (prendas 3D), combina outfits sobre su avatar y recibe recomendaciones de tiendas según talla, fit preferido y colorimetría.

**Plataformas:** web, Android e iOS desde un único código (Expo + React Native + React Three Fiber).

Plan completo: https://claude.ai/artifact/NTjptmfYWP4XQUwfVG3m5C
Resumen del plan: `.claude/skills/probador-3d-multiagente/references/proyecto.md`

## Estructura del monorepo

| Carpeta | Contenido |
|---|---|
| `apps/app` | App Expo (web, Android, iOS) |
| `packages/contracts` | Tipos y esquemas compartidos (TypeScript + JSON Schema) |
| `services/` | API y workers GPU (Python) |
| `supabase/` | Migraciones de base de datos |
| `docs/` | Arquitectura, decisiones e investigación de la fase 0 |

## Reglas del proyecto

- Privacidad (RGPD): las fotos de cuerpo y cara se borran tras procesarlas; solo se guardan valores calculados. Servidores en la UE, consentimiento explícito, borrado total.
- Licencias: comprobar la licencia comercial de cada modelo o dataset.
- El avatar es SMPL-X (o alternativa compatible); el 3D viaja en glTF/GLB.
- Validar con todos los tonos de piel y tipos de cuerpo.
