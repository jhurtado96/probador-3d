# Fit y holgura

Estado: diseño de fase 0 (2026-11-11). Las cifras marcadas como «inicial» son puntos de partida de patronaje que el prototipo debe calibrar. Las licencias marcadas «sin verificar» hay que leerlas antes de usar el recurso.

## 1. Resumen

Recomendamos separar dos preguntas que el plan mezclaba: qué fit quiso el diseñador (atributo de la prenda, lo predice un clasificador) y cómo le queda a esta persona (holgura por zona, se calcula con reglas y con incertidumbre).

- Holgura = contorno de la prenda − contorno del cuerpo, por zona, con umbrales por categoría.
- «Oversize de diseño» frente a «talla mayor» se decide comparando zonas ancla (cuello, puño, cintura, alcance de manga) con zonas de volumen (pecho, bajo, bíceps, hombro), en unidades de talla.
- El mayor riesgo es la incertidumbre: 3 cm de error de cuerpo más 1,5 cm de error de prenda en plano (3 cm en contorno) suman unos 4 cm, casi una talla. El resultado se muestra como banda, no como etiqueta tajante.
- DeepFashion2 no tiene licencia comercial clara: los keypoints de prenda hay que entrenarlos con datos propios y sintéticos.

## 2. Holgura por zona y umbrales

Calcular la holgura en centímetros de contorno y también en porcentaje del cuerpo, y clasificar cada zona en cinco niveles con umbrales por categoría.

```
holgura_z = prenda_z · (1 + k_z · elasticidad) − cuerpo_z
holgura_pct_z = holgura_z / cuerpo_z
```

- `prenda_z`: contorno (ancho en plano × 2) o longitud.
- `cuerpo_z`: medida del avatar en la misma zona (`Avatar.measurements` con `measurements_override` aplicado, sea cual sea el modelo corporal). La correspondencia zona → medida es única y está en el contrato (`FIT_ZONE_BODY_MEASUREMENT`: `shoulder` → `shoulder_width_cm`, `sleeve_length` → `arm_length_cm`, `cuff` → `wrist_cm`, `body_length` → `torso_length_cm`, `knee` → `knee_cm`, `rise` → `rise_cm`…; `hem` no tiene medida corporal). Si falta la medida corporal de una zona, la zona se omite; si falta en una zona ancla, `size_offset` es `null` cuando no queda ninguna ancla medible y la confianza no pasa de 0,5 (`FIT_MAX_CONFIDENCE_WITHOUT_ANCHOR`; revisión de la fase 0, M7).
- `elasticidad`: 0 en tejido plano, 0,05–0,15 en punto, hasta 0,3 con elastano; k_z = 1 en contornos, 0 en largos.
- Incertidumbre: σ_holgura = √(σ_cuerpo² + σ_prenda²); cada etiqueta lleva la probabilidad de cada nivel.

### Zonas por categoría

| Categoría | Contornos | Largos y anchos |
|---|---|---|
| Camiseta, camisa | pecho, cintura, bajo, bíceps, cuello (camisa), puño (camisa) | hombro, manga, largo total |
| Chaqueta | pecho, cintura, bajo, bíceps | hombro, manga, largo |
| Pantalón | cintura, cadera, muslo, rodilla, bajo | tiro, entrepierna |
| Vestido | pecho, cintura, cadera | hombro, largo, manga |

### Umbrales de holgura (cm de contorno, iniciales)

| Categoría y zona | Pequeña | Ajustado | Regular | Holgado | Oversize |
|---|---|---|---|---|---|
| Camiseta (punto), pecho | < 0 | 0–6 | 6–14 | 14–22 | > 22 |
| Camisa (plano), pecho | < 5 | 5–10 | 10–16 | 16–24 | > 24 |
| Chaqueta o blazer, pecho | < 6 | 6–10 | 10–16 | 16–22 | > 22 |
| Abrigo, pecho | < 12 | 12–18 | 18–26 | 26–34 | > 34 |
| Pantalón, cintura | < −2 | −2–1 | 1–3 | 3–5 (necesita cinturón) | > 5 (grande) |
| Pantalón, cadera | < 2 | 2–4 | 4–8 | 8–14 | > 14 |
| Pantalón, muslo | < 2 | 2–5 | 5–8 | 8–12 | > 12 |
| Vestido (plano), pecho | < 3 | 3–6 | 6–10 | 10–18 | > 18 |
| Vestido, cintura | < 2 | 2–5 | 5–10 | 10–20 | > 20 |
| Vestido, cadera | < 3 | 3–6 | 6–10 | 10–18 | > 18 |

Largos y hombro (prenda − cuerpo):

| Medida | Corto o estrecho | Correcto | Largo o caído |
|---|---|---|---|
| Hombro (frente a anchura biacromial) | < −1 | −1 a +1,5 | +1,5 a +4 ligeramente caído; > +4 hombro caído |
| Manga larga (hasta muñeca) | < −2 | −2 a +1,5 | > +1,5 |
| Entrepierna | < −3 | −3 a +2 | > +2 |
| Largo de camiseta (bajo respecto a la cadera) | por encima de la cintura | cadera ± 4 | por debajo del tiro |

Origen de los valores: referencias de patronaje consultadas (camisas 10–14 cm de holgura de pecho, chaquetas 16–24, abrigos 20–28; chaquetas ajustadas 6–8, regulares 10–14, holgadas 14–20; pantalón 2–2,5 cm en cintura, unos 4 en cadera y 2,5 en muslo). Las fuentes son blogs y guías del sector y no coinciden entre sí; por eso son iniciales y se recalibran con las etiquetas de los usuarios.

## 3. Oversize de diseño frente a talla mayor

Decidirlo con un «índice de talla por zona»: una talla mayor sube todas las zonas a la vez; un oversize de diseño sube las zonas de volumen y deja las zonas ancla en la talla de la persona.

### Señales

| Señal | Oversize de diseño | Talla mayor |
|---|---|---|
| Cuello (camisa) o escote | Corresponde a la talla nominal | Crece con la talla |
| Hombro caído y manga | Hombro +4 cm o más y manga acortada; el alcance (medio hombro + manga) coincide con el brazo | El alcance crece 2–3 cm por talla y la manga tapa la mano |
| Ancho / largo | Proporción alta (camiseta ≥ 0,80, corte cuadrado) | Proporción de la marca (≈ 0,70–0,75) |
| Sisa y bíceps | Sisa baja y manga ancha para su largo | Crecen en proporción |
| Puño y bajo de manga | A la medida de la muñeca | Crecen |
| Pantalón: cintura | Ajusta (holgura 0–3) con cadera y muslo amplios | Cintura también grande (> 4) |
| Texto y metadatos | «oversized», «boxy», «relaxed», «drop shoulder», nombre de línea de fit | Nada, o «regular» |
| Tabla de la marca | La talla recomendada para su cuerpo es la que lleva | La tabla recomienda una talla menor |

### Reglas de escalado

Incrementos típicos entre tallas consecutivas (iniciales; se sustituyen por los de cada marca cuando la tabla los da):

| Medida | Incremento por talla |
|---|---|
| Pecho, cintura, cadera (contorno) | 4–5 cm (2,5 en tallas centrales de algunas marcas, 5 o más en tallas grandes) |
| Hombro | 0,6–1,2 cm |
| Largo de manga | 1,2–2 cm |
| Largo de cuerpo | 1–2 cm |
| Cuello | 1 cm |

Índice de talla por zona, respecto a un fit regular para esa persona:

```
s_z = (prenda_z − (cuerpo_z + holgura_regular_z)) / incremento_z
```

- Anclas A: cuello, puño, cintura del pantalón, alcance de manga, largo.
- Volumen B: pecho, bajo, bíceps, hombro, cadera y muslo del pantalón.

```
s_A = mediana(s_z, z ∈ A)      s_B = mediana(s_z, z ∈ B)      D = s_B − s_A
```

| Condición | Resultado |
|---|---|
| \|s_A\| ≤ 0,75 y D ≥ 1,5 | Oversize de diseño en su talla |
| s_A ≥ 0,75 y D < 1 | Talla mayor (s_A tallas de más) |
| s_A ≥ 0,75 y D ≥ 1,5 | Oversize de diseño y además talla mayor |
| \|s_A\| ≤ 0,75 y \|D\| < 1 | Su talla, fit regular |
| s_A ≤ −0,75 | Talla menor |

Estas reglas son la línea base y la explicación que se muestra al usuario.

### Clasificador

Entrenar un gradient boosting (LightGBM o `HistGradientBoosting` de scikit-learn) que prediga el fit de diseño de la prenda en su talla nominal: ajustado, regular, holgado u oversize.

- Entrada sin usuario: es un atributo de la prenda, se calcula una vez y se guarda.
- Características: medidas normalizadas por la tabla de cuerpo de la marca para esa talla (s_z de cada zona, s_A, s_B, D), proporciones (ancho/largo, hombro/pecho, manga/largo, sisa/pecho, bajo/pecho), categoría, departamento, elasticidad, palabras clave del título y la descripción, marca.
- Datos: fichas de producto de tiendas donde la marca declara el fit («Oversized fit», «Slim fit»…) y da medidas de prenda por talla. Objetivo: 5000–10 000 productos con etiqueta débil sacada del texto.
- Conjunto de referencia: 500 prendas etiquetadas a mano por dos personas con formación en patronaje, con desacuerdos resueltos; sirve para medir el ruido de la etiqueta débil y para evaluar.
- Segundo conjunto para el caso difícil: 60–100 pares de la misma prenda en su talla y en una o dos tallas más, junto a prendas oversize de diseño de la talla base.
- Sin fuga: partir por marca, no por producto.
- Objetivos: macro-F1 ≥ 0,80 en 4 clases; ≥ 85 % en diseño frente a talla mayor.

Para prendas del armario del usuario (sin ficha de producto) se usan las medidas por foto, la talla de la etiqueta y, si la marca está en la base, su tabla; si no, solo las reglas.

## 4. Medición de prendas por foto

Pedir una foto cenital de la prenda extendida con un folio A4 al lado, rectificar con homografía y medir entre puntos clave que el usuario puede corregir arrastrándolos.

### Captura

- Prenda extendida y alisada sobre un fondo liso que contraste, cremalleras y botones cerrados.
- A4 (210 × 297 mm) en el mismo plano, pegado a la prenda. Mejor que una tarjeta (85,6 × 53,98 mm): al ser cuatro veces mayor, el error de escala y de perspectiva al extrapolar es mucho menor. La tarjeta queda como alternativa con aviso de menor precisión.
- Cámara principal (no gran angular), a 1–1,5 m, paralela al suelo: la app guía con el acelerómetro y bloquea el disparo con más de 10° de inclinación.
- Con iPhone con LiDAR, ARKit da plano y escala sin referencia (fase 3).

### Pipeline

1. Detectar el A4: segmentación y ajuste de cuadrilátero con esquinas a subpíxel; comprobar la proporción 1:1,414 (± 3 %) tras rectificar.
2. Homografía de las cuatro esquinas al plano métrico y remuestreo de la imagen a escala fija (por ejemplo 2 px/mm).
3. Segmentar la prenda (SAM 2 o BiRefNet, los mismos del módulo de prenda 3D).
4. Puntos clave por categoría (10–16 puntos de medida, alineados con las plantillas paramétricas).
5. Medidas = distancias entre pares de puntos; los contornos son el doble del ancho en plano.
6. Pantalla de revisión: el usuario mueve los puntos; cada corrección es una etiqueta nueva de entrenamiento.

Línea base sin red para la primera semana: medir sobre el contorno de la máscara (axilas como concavidades, ancho a la altura de la axila, extremos de manga y bajo).

### Keypoints: datos y licencias

| Recurso | Contenido | Licencia | Decisión |
|---|---|---|---|
| DeepFashion2 | 491 000 imágenes, 13 categorías, 294 landmarks | Sin licencia declarada en el repositorio; descarga con formulario y contraseña; su antecesor DeepFashion es solo investigación no comercial | No usar en producción. Como mucho, experimento interno tras leer el formulario |
| Copias de DeepFashion2 en Roboflow con «CC BY 4.0» | Resubidas por terceros | No son los términos de los autores | No fiarse |
| Fashionpedia | 46 000 imágenes, segmentación y atributos | CC BY 4.0 (anotaciones; derechos de las fotos por comprobar) | Preentrenar segmentación |
| GarmentCode / GarmentCodeData | Patrones paramétricos y prendas 3D | Código MIT según un espejo; dataset sin verificar | Generar vistas planas sintéticas con puntos exactos |
| Datos propios | Fotos en plano anotadas | Nuestra | Base del modelo: 1500–3000 fotos |

Además, DeepFashion2 es sobre todo ropa puesta y sus landmarks no coinciden con puntos de medida; aunque la licencia lo permitiera, haría falta reanotar.

Arquitectura: un estimador de pose con licencia permisiva (RTMPose/MMPose o ViTPose, Apache 2.0 según recordamos, sin verificar en esta sesión). Evitar Ultralytics YOLO-pose salvo licencia de empresa (AGPL-3.0, sin verificar en esta sesión).

### Error esperado

| Fuente de error | Magnitud |
|---|---|
| Escala y perspectiva con A4 e inclinación < 10° | 0,5–1 % (0,3–0,7 cm en 70 cm) |
| Con tarjeta en vez de A4 | 2–3 % |
| Localización de puntos clave | 0,5–1,5 cm |
| Prenda mal extendida, arrugas, tejido elástico | 1–2 cm |
| Sin referencia de escala | 10–15 cm (Appl. Sci. 2022) |

- Objetivo: error medio ≤ 1,5 cm en anchos y ≤ 2 cm en largos y mangas.
- Literatura: 0,75–1,27 cm de error medio según el tipo de prenda (Appl. Sci. 2022, 12(9):4470); 1,6–2,1 % de error relativo con LiDAR más keypoints (Kim et al.); la tolerancia habitual en la industria es de unos 2 cm.
- La cinta métrica tampoco es exacta: dos personas midiendo la misma prenda difieren 0,5–1 cm; ese es el suelo.

## 5. Tablas de medidas por marca

Construir la base con curación propia de las 50–100 marcas principales guardando solo hechos numéricos con su procedencia, y ampliar por acuerdos con marcas y medidas aportadas por usuarios; no depender del scraping masivo.

### Fuentes

| Fuente | Qué da | Nota |
|---|---|---|
| Guías de tallas de las marcas | Medidas de cuerpo por talla | La más disponible; hay que estimar la prenda |
| Fichas de producto con medidas de prenda | Medidas de prenda por talla | Lo mejor para fit; pocas marcas lo publican |
| Feeds de afiliación (Awin, Rakuten, CJ, Impact) | Etiqueta de talla, rara vez medidas | Sirven para enlazar producto con tabla |
| Acuerdos directos y SDK para marcas (fase 4) | Fichas técnicas | La fuente más limpia |
| Usuarios | Prendas medidas por foto con marca y talla | Crece sola; necesita control de calidad |
| EN 13402 e ISO 8559 | Definición de medidas y etiquetado | Vocabulario común, no datos de marca |

Cuando solo hay tabla de cuerpo: prenda ≈ punto medio del rango de cuerpo + holgura regular de la categoría y línea de fit. Es una estimación de ± 3–4 cm y se marca con baja confianza.

### Esquema mínimo

`brand`, `department`, `category`, `fit_line`, `size_label`, `size_system` (EU, UK, US, IT, alfa), `measure_type` (cuerpo o prenda), `measures` (mínimo y máximo por zona, en cm), `source_url`, `retrieved_at`, `method` (manual, feed, socio, usuario), `confidence`.

### Marco legal (UE; no es asesoramiento jurídico)

- Una medida suelta es un hecho y no tiene derecho de autor; la maquetación, los textos y las imágenes de la guía sí pueden tenerlo: no se copian.
- El riesgo real es el derecho sui generis de bases de datos (extraer una parte sustancial de una base con inversión sustancial) y las condiciones de uso de la web, que pueden prohibir el scraping por contrato aunque no haya derecho de propiedad intelectual (caso Ryanair).
- El artículo 4 de la Directiva de derechos de autor en el mercado único digital permite la minería de textos y datos con fines comerciales salvo reserva expresa del titular, y no está protegido frente a cláusulas contractuales.
- Práctica recomendada: recoger pocas tablas por sitio, a mano o con supervisión; respetar robots.txt y las reservas legibles por máquina; guardar URL y fecha; no redistribuir la base en bruto; revisión de un abogado antes de automatizar.

## 6. Preferencia de fit del usuario

Modelar la preferencia como una holgura objetivo por categoría y zona con su tolerancia, iniciada con una pregunta y una prenda favorita, y actualizada de forma bayesiana con cada opinión.

- Estado por usuario, categoría y zona: holgura preferida μ_z, tolerancia σ_z y número de observaciones.
- Arranque: (a) pregunta «ajustado, regular u holgado» para parte de arriba y de abajo, que fija μ_z en el centro del nivel elegido; (b) «mide tu prenda favorita»: sus holguras son la mejor señal y cuentan como 3 observaciones.
- Actualización con «me queda perfecto» (holgura e): media normal conjugada, μ ← (n·μ + e) / (n + 1).
- Actualización con «apretado» o «grande» en una zona: observación censurada (la preferencia está por encima o por debajo de e); se desplaza μ un 25 % de la distancia hacia el lado indicado y se estrecha σ.
- Señales implícitas: prendas más usadas en outfits, compras guardadas y, en fase 4, devoluciones por talla.

Puntuación de ajuste de una prenda en una talla:

```
f_z = exp(−0,5 · ((holgura_z − μ_z) / σ_z')²)     σ_z' = 0,6·σ_z si holgura_z < μ_z (apretar penaliza más)
fit_score = Σ_z p_z · f_z / Σ_z p_z                p_z = importancia de la zona
fit_score = 0 si alguna zona queda por debajo del mínimo «pequeña»
```

- Talla recomendada: la que maximiza `fit_score`; se muestra la segunda opción si la diferencia es menor de 0,1.
- Prendas oversize de diseño: la preferencia de tamaño se compara en las zonas ancla y el volumen se trata como gusto de estilo aparte (¿le gustan las siluetas oversize?), para no recomendar una talla menor que rompa el diseño.
- Más adelante: gradient boosting sobre holguras, preferencia y categoría para predecir «se la queda» frente a «la devuelve por talla».

Entra en el ranking con el peso 0,3 del plan.

## 7. Riesgos

- Incertidumbre acumulada cercana a una talla: sin medidas de prenda reales (solo tabla de cuerpo) la recomendación de talla es débil.
- Pocas marcas publican medidas de prenda; la base depende de curación manual y de usuarios.
- Etiquetas de fit de las marcas inconsistentes («relaxed» de una es «regular» de otra): por eso se normaliza con la tabla de cada marca.
- Licencia de DeepFashion2: no asumir uso comercial.
- Tejidos elásticos y prendas que no se pueden extender en plano (americanas estructuradas, plisados).

## 8. Fuentes

Abiertas o consultadas en esta sesión:

- DeepFashion2 (repositorio oficial): https://github.com/switchablenorms/DeepFashion2 · artículo: https://arxiv.org/abs/1901.07973
- Acuerdo de DeepFashion: https://mmlab.ie.cuhk.edu.hk/projects/DeepFashion/DeepFashionAgreement.pdf
- Fashionpedia: https://huggingface.co/datasets/detection-datasets/fashionpedia · https://arxiv.org/abs/2004.12276
- GarmentCodeData: https://arxiv.org/abs/2405.17609
- Medición automática de prendas (Appl. Sci. 2022): https://mdpi.com/2076-3417/12/9/4470 · GarmentIQ: https://garmentiq.ly.gd.edu.kg/
- Escalado de tallas: https://www.size.ly/blog/size-grading-for-apparel-brands · https://techpacker.com/blog/design/pattern-grading-in-the-fashion-garment-industry/ · https://dineshexports.com/measurement-grading-rule-for-garments/
- Holguras: https://mytextilenotes.blogspot.com/2014/08/some-notes-about-fittng-and-ease-in.html · https://decrum.ca/blogs/news/decoding-chest-ease-and-finished-garment-dimensions · https://doaj.org/article/17d3f50927fc45628ee46989f1724c04
- Scraping y derecho de bases de datos en la UE: https://emlaw.co.uk/data-scraping-navigating-the-challenges-old-and-new-part-2-intellectual-property/ · https://themarkup.org/levelup/2023/08/23/how-to-legally-scrape-eu-data-for-investigations · https://copyrightblog.kluweriplaw.com/2025/05/08/third-european-court-decision-on-the-general-purpose-tdm-exception-is-out/

No se pudo abrir www.mdpi.com (fuera de la red permitida de la sesión): las cifras del artículo de Appl. Sci. vienen del resumen del buscador. Las licencias de RTMPose, ViTPose, Ultralytics, LightGBM, SAM 2 y BiRefNet no se comprobaron en esta sesión.
