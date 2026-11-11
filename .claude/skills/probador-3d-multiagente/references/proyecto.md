# Resumen del plan del proyecto

Fuente de verdad: https://claude.ai/artifact/NTjptmfYWP4XQUwfVG3m5C (si difiere de este resumen, manda el documento).

## Módulos

| Módulo | Enfoque | Tecnologías clave |
|---|---|---|
| Avatar 3D | Foto de cuerpo entero + altura → SMPL-X con medidas | MediaPipe (validar pose), SMPLer-X / HMR 2.0 / Multi-HMR; textura opcional con LHM, ECON o PSHuman; licencia SMPL-X o alternativa abierta (Anny) |
| Prenda 3D | Nivel 1: plantillas paramétricas + textura; nivel 2: foto → patrón de costura; nivel 3: 3D nativo de marca | SAM 2 / BiRefNet, modelo de visión para atributos, Sewformer / ChatGarment / GarmentCode, CLO3D / Style3D |
| Drapeado | Simulación en servidor, cacheada por avatar + prenda + talla | NVIDIA Warp / XPBD, HOOD, SNUG |
| Armario y outfits | Subida, etiquetado automático corregible, creador de outfits en 3D | — |
| Recomendaciones | Embeddings + compatibilidad + estilista con IA; ranking = 0,4 compatibilidad + 0,3 color + 0,3 ajuste | FashionCLIP / Marqo-FashionSigLIP, pgvector |
| Tiendas | Feeds de afiliación, normalización de tallas, mismo pipeline 3D | Awin, Rakuten, CJ, Impact, Zalando, Shopify Storefront |
| Colorimetría | Selfie + referencia de blanco → CIELAB → subtono, valor, intensidad, contraste → 12 estaciones → paleta; puntuación ΔE2000 por prenda (más peso cerca de la cara) | SegFormer/BiSeNet face parsing, MediaPipe Face Mesh |
| Fit | Holgura por zona = medida prenda − medida cuerpo; distinguir oversize de diseño vs talla mayor por proporciones (hombro caído, manga, ancho/largo) y reglas de escalado; preferencias aprendidas | Tablas de medidas de marca, DeepFashion2 keypoints, foto con objeto de referencia, LiDAR/ARKit, gradient boosting |

## Arquitectura

App (React Native/Expo + React Three Fiber, o PWA con Next.js) → API backend (usuarios, armario, catálogo, ranking, cola) → workers GPU en Python serverless (avatar y colorimetría; prenda 3D y fit; drapeado) → Postgres + pgvector y S3/R2 (GLB, imágenes). Tiendas entran por ingesta diaria.

## Fases

| Fase | Duración | Contenido |
|---|---|---|
| 0. Investigación | 4–6 semanas | Prototipos avatar, prenda en plantilla, drapeado; colorimetría desde selfie; base de tablas por marca; licencias. Decisión go/no-go sobre la calidad visual |
| 1. MVP | 3–4 meses | Avatar 3D, armario con etiquetado, prendas nivel 1 (5–8 categorías), outfits en 3D, colorimetría básica, fit por etiqueta y texto |
| 2. Tiendas | 2–3 meses | Catálogo de 2–3 redes, recomendaciones por embeddings, ranking con color y fit, talla recomendada |
| 3. Realismo | 3–4 meses | Prendas nivel 2, mapas de ajuste, capas, poses, medición por foto/LiDAR, clasificador de fit, drapeado de color |
| 4. Escala y B2B | continuo | Estilista con IA, modelo de compatibilidad propio, SDK para marcas, aprendizaje con devoluciones |

## Modelo de datos

users, avatars, color_profiles, garments, garment_measurements, fit_results, user_fit_preferences, outfits, store_products, drape_cache, jobs.

## Métricas clave

Error de medidas < 3 cm; coincidencia de colorimetría con asesores > 75 %; conversión de recomendaciones; reducción de devoluciones.
