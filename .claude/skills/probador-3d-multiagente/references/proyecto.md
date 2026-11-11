# Resumen del plan del proyecto

Fuente de verdad del plan: https://claude.ai/artifact/NTjptmfYWP4XQUwfVG3m5C (si difiere de este resumen, manda el documento). Las decisiones técnicas tomadas después están en `docs/architecture.md` §7 (registro de decisiones) y mandan sobre el plan; las de la fase 0 ya están reflejadas en la tabla.

## Módulos

| Módulo | Enfoque | Tecnologías clave |
|---|---|---|
| Avatar 3D | Foto de cuerpo entero + altura → cuerpo paramétrico con medidas ISO 8559-1. El avatar es independiente de la topología: GLB + medidas + nombre del modelo corporal | MediaPipe (validar pose), SAM 3D Body → MHR + ajuste de forma propio, port de SMPL-Anthropometry; Anny como alternativa abierta y SOMA-X como posible adaptador. SMPL-X y sus estimadores (SMPLer-X, HMR 2.0, Multi-HMR) no son comerciales |
| Prenda 3D | Toda prenda es un patrón de costura de GarmentCode. Nivel 1: configuración cerrada por categoría + textura; nivel 2: foto → parámetros libres del patrón; nivel 3: 3D nativo de marca | SAM 2, modelo de visión para atributos, GarmentCode (ChatGarment como referencia; Sewformer descartado), CLO3D / Style3D |
| Drapeado | Simulación física estática en servidor, cacheada por avatar + prenda + talla | NVIDIA Warp / Newton (Apache 2.0); el drapeado neuronal (HOOD, ContourCraft) exige SMPL y queda para investigación |
| Armario y outfits | Subida, etiquetado automático corregible, creador de outfits en 3D | — |
| Recomendaciones | Embeddings + compatibilidad + estilista con IA; ranking = 0,4 compatibilidad + 0,3 color + 0,3 ajuste | FashionCLIP / Marqo-FashionSigLIP, pgvector |
| Tiendas | Feeds de afiliación, normalización de tallas, mismo pipeline 3D | Awin, Rakuten, CJ, Impact, Zalando, Shopify Storefront |
| Colorimetría | Selfie + referencia de blanco → CIELAB → subtono, valor, intensidad, contraste → 12 estaciones → paleta; puntuación ΔE2000 por prenda (más peso cerca de la cara) | MediaPipe Face Landmarker y segmentador multiclase (los pesos públicos de SegFormer/BiSeNet no son comerciales) |
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
