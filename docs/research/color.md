# Colorimetría personal desde un selfie

Estado: diseño de fase 0 (2026-11-11). Las cifras marcadas como «inicial» son puntos de partida que el prototipo debe calibrar. Las licencias marcadas «sin verificar» no se pudieron abrir en esta sesión y hay que leerlas antes de usar el recurso.

## 1. Resumen

Recomendamos un pipeline de medida, no una red de extremo a extremo: selfie con folio blanco → corrección de blanco → máscaras de piel, pelo e iris con modelos Apache 2.0 de MediaPipe → 12–15 características en CIELAB → clasificador por prototipos en tres ejes (temperatura, valor, croma) que devuelve estación, confianza y estaciones vecinas.

- El cuello de botella es la luz, no el modelo: la diferencia entre subtono cálido y frío es de pocos grados de tono, del mismo orden que el error de un móvil sin calibrar.
- Ningún dataset público sirve para entrenar ni validar en producción (ni licencia ni verdad de color). Hay que crear uno propio de 150–200 personas.
- El resultado siempre lleva confianza y avisos de calidad; con mala luz se pide repetir en vez de clasificar.

## 2. Captura y corrección de la luz

Usar un folio blanco A4 sujeto junto a la mejilla como referencia de blanco y exposición, y rechazar la captura si no pasa los controles de calidad.

### Protocolo de captura

- Luz de día indirecta, de frente a una ventana; sin flash ni luces de color; sin maquillaje, gafas ni filtros de belleza.
- Cámara principal si es posible (la frontal vale); sin modo retrato ni HDR agresivo si la plataforma permite desactivarlo.
- Folio en el mismo plano que la cara, pegado a la mandíbula, sin sombra propia.
- Tres disparos seguidos; se usa la mediana de las medidas.
- Pregunta obligatoria: «¿tu pelo es natural o teñido?» (si es teñido, el pelo sale del cálculo de subtono).

### Corrección

1. Respetar el perfil ICC de la imagen (los iPhone guardan en Display P3, no sRGB) y pasar a RGB lineal.
2. Localizar el folio (cuadrilátero claro de croma baja dentro de la guía de pantalla) y tomar la mediana de su zona central.
3. Ganancias por canal para que el folio quede neutro, aplicadas como adaptación cromática Bradford en XYZ; escalar la exposición para que el folio quede en L* ≈ 94.
4. Convertir a CIELAB (D65) y trabajar solo en Lab a partir de aquí.

Limitación conocida: el papel de oficina lleva blanqueantes ópticos y es algo azulado (b* negativo) con luz de día, lo que desplaza la piel corregida hacia cálido. Se compensa con un sesgo fijo estimado en el prototipo fotografiando el folio junto a una carta de color. El folio corrige punto blanco y exposición, no la respuesta espectral de la cámara.

### Avisos de calidad (bloquean o bajan la confianza)

| Control | Umbral inicial | Acción |
|---|---|---|
| Folio quemado (canal > 250) o cara quemada | > 1 % de píxeles | Repetir |
| Folio oscuro (subexposición) | L* sin corregir < 60 | Repetir |
| Luz muy cálida o fría (temperatura estimada con el folio) | fuera de 4000–7500 K | Repetir |
| Folio no uniforme (sombra, degradado) | desviación de L* > 3 | Repetir |
| Luz lateral: diferencia entre mejillas | ΔL* > 8 | Aviso, baja confianza |
| Luz mixta: tinte del folio distinto al de la esclerótica | ΔE00 > 6 tras corregir | Aviso |
| Desenfoque o cara pequeña | distancia entre ojos < 250 px | Repetir |
| Iris pequeño | diámetro < 40 px | Ojos fuera del cálculo |
| Dispersión entre los tres disparos | ΔE00 de piel > 3 | Repetir |

### Error de color esperable

| Situación | Error típico | Origen |
|---|---|---|
| Móvil calibrado con carta de color, en laboratorio | ΔE 1,8–6,6 (CIE76), 1,1–4,5 (CIE94) | Cugmas y Štruc, Sensors 2020 (piel canina) |
| Diferencia entre móviles tras calibrar | ΔE 2,0–3,9 (CIE76) | mismo estudio |
| Matriz de corrección lineal en piel humana | reduce el error 67–77 %, hasta ΔE < 2,3 | preprint arXiv 2512.21988 (sin revisión por pares) |
| Solo folio blanco, luz de día (nuestro caso) | ΔE00 3–6 | estimación propia, a medir |
| Sin referencia | ΔE00 8–15 o más | estimación propia, a medir |

El mismo preprint avisa de que un ΔE bajo no garantiza medidas derivadas estables: el ITA tuvo poca concordancia entre dispositivos (ICC 0,40). Por eso no usamos umbrales absolutos duros y propagamos la incertidumbre a la confianza.

## 3. Pipeline

Usar MediaPipe Face Landmarker para las regiones geométricas y el segmentador multiclase de MediaPipe para piel y pelo; ambos son Apache 2.0 y corren en el dispositivo, así el selfie no tiene por qué salir del móvil.

### Segmentación: modelos y licencias

| Modelo | Licencia | Decisión |
|---|---|---|
| MediaPipe Selfie Multiclass (fondo, pelo, piel del cuerpo, piel de la cara, ropa, otros) | Apache 2.0 (ficha del modelo, mayo 2023) | Usar. IoU media 81,1; peor grupo de tono de piel 71,9 |
| MediaPipe Face Landmarker (478 puntos, incluye iris) | Apache 2.0 | Usar para mejillas, frente, mandíbula, labios, iris |
| jonathandinu/face-parsing (SegFormer + CelebAMask-HQ) | No comercial según su ficha | No usar |
| BiSeNet face-parsing.PyTorch | Código MIT, pesos entrenados con CelebAMask-HQ (no comercial) | No usar los pesos |
| FaRL / facer | Sin verificar; entrenado con CelebAMask-HQ / LaPa | No usar sin revisión |
| Sapiens (Meta) | CC BY-NC 4.0 | No usar |
| Sapiens2 | Licencia propia de Meta, sin verificar | Revisar si hiciera falta más precisión |
| EasyPortrait (40 000 imágenes; piel, cejas, ojos, labios, dientes; sin pelo) | Variante de CC BY-SA 4.0; leer el PDF de licencia | Candidato para entrenar un parser propio |

El plan citaba «SegFormer/BiSeNet»: las arquitecturas valen, los pesos públicos no. Si el segmentador de MediaPipe se queda corto (barba, flequillo, velo), entrenar un modelo propio con datos de licencia limpia.

### Medidas

| Zona | Cómo | Robustez |
|---|---|---|
| Piel | Mejillas, frente y mandíbula (polígonos de landmarks) ∩ máscara de piel | Descartar L* fuera de los percentiles 10–90 (brillos y sombras); mediana por región y luego mediana entre regiones |
| Pelo | Máscara de pelo erosionada 5 px | Percentiles 20–80 de L*; ignorar si es teñido, canoso > 50 %, cubierto o ausente |
| Ojos | Anillo del iris entre 0,45 r y 0,9 r | Quitar reflejos y párpado; mediana de ambos ojos |
| Esclerótica y labios | Polígonos de landmarks | Solo control de calidad y señal secundaria |

Por cada zona se guardan L*, a*, b*, croma C* = √(a*² + b*²), tono h = atan2(b*, a*) y el rango intercuartílico.

### Características derivadas

- ITA = atan2(L* − 50, b*) · 180/π. Sirve para describir la claridad y para estratificar la validación, no para decidir la estación: no usa a*, es sensible a la luz y no hay consenso en sus cortes (el esquema habitual es 55 / 41 / 28 / 10 / −30).
- Temperatura T: tono de la piel relativo al esperado para su claridad, T = (h_piel − h_ref(L*)) / σ_h(L*). La referencia h_ref se ajusta con nuestro dataset por tramos de L*; es la pieza clave contra el sesgo, porque el tono medio cambia con la claridad. Valor inicial sin datos: h_ref = 55°, σ_h = 6°. Se combina con pelo y ojos: T = 0,6·T_piel + 0,25·T_pelo + 0,15·T_ojos.
- Valor V: L combinada = 0,5·L_piel + 0,35·L_pelo + 0,15·L_ojos, normalizada a z.
- Intensidad S: croma combinado = 0,4·C_piel (relativo a su claridad) + 0,3·C_ojos + 0,3·C_pelo, normalizada a z.
- Contraste K: mayor diferencia de L* entre piel, pelo y ojos. Bajo < 25, medio 25–45, alto > 45 (inicial).

Si falta pelo u ojos, se renormalizan los pesos y la confianza baja.

## 4. Clasificación en 12 estaciones

Empezar con reglas por prototipos en el espacio (T, V, S) y pasar a un modelo aprendido sobre las mismas características cuando haya al menos 600 personas etiquetadas; no entrenar una red sobre píxeles.

### Reglas (fase 0 y MVP)

Cada estación es un punto en (T, V, S) en unidades z. Se elige la más cercana y la confianza sale de un softmax sobre las distancias.

| Estación | T | V | S |
|---|---|---|---|
| Primavera clara | +0,5 | +1,0 | +0,3 |
| Primavera cálida | +1,0 | +0,3 | +0,5 |
| Primavera brillante | +0,4 | 0 | +1,0 |
| Verano claro | −0,5 | +1,0 | −0,3 |
| Verano frío | −1,0 | +0,3 | −0,5 |
| Verano suave | −0,4 | 0 | −1,0 |
| Otoño suave | +0,4 | 0 | −1,0 |
| Otoño cálido | +1,0 | −0,3 | −0,3 |
| Otoño profundo | +0,5 | −1,0 | 0 |
| Invierno profundo | −0,5 | −1,0 | +0,3 |
| Invierno frío | −1,0 | −0,3 | +0,5 |
| Invierno brillante | −0,4 | 0 | +1,0 |

p(estación) = softmax(−d² / τ), con τ = 0,5 inicial. Confianza final = p máxima × factor de calidad de captura (0–1). Si la confianza es menor de 0,45 se muestran las dos estaciones candidatas.

Ventajas: no necesita datos, es explicable («cálido, claro, intensidad media») y los prototipos se pueden reajustar con pocas etiquetas.

### Modelo aprendido (fase 2 en adelante)

Regresión logística multinomial o gradient boosting sobre las 12–15 características Lab más los indicadores de calidad. Se adopta solo si supera a las reglas en al menos 5 puntos con validación cruzada por persona.

### Etiquetas

- Quién: 3 asesores de imagen por persona, de forma independiente, con el mismo sistema de 12 estaciones acordado por escrito antes de empezar.
- Cómo: lo ideal es sesión presencial con telas de prueba y luz controlada; la alternativa barata es etiquetar sobre foto calibrada con carta de color.
- Etiqueta de referencia: mayoría de 2 de 3; se guarda también la segunda opción de cada asesor.
- Techo humano: medir el acuerdo entre asesores (kappa de Fleiss). Si entre ellos no llegan al 75 %, el objetivo del 75 % del plan no es alcanzable como coincidencia exacta y hay que redefinirlo (ver prototipos).
- Cuántas: 150–200 personas para validar (al menos 12 por estación y 15 por tono de la escala Monk; con n = 150 el intervalo de un 75 % es ±7 puntos); 600–1000 para entrenar (al menos 50 por estación).

Deep Armocromia (ECCV 2024 Workshops, unas 5000 caras de famosos con 4 estaciones y 12 subtipos) es el único dataset público del problema, pero es «solo para fines científicos y de investigación», sale de CelebA y sus fotos no están calibradas. Sirve como referencia de protocolo, no como dato.

## 5. Paleta y puntuación de prendas

Generar la paleta puntuando un catálogo fijo de unos 400 colores de moda contra el perfil del usuario, y puntuar cada prenda por su ΔE2000 a esa paleta, ponderado por la cercanía a la cara medida sobre el avatar.

### Paleta

1. Cada estación define rangos en LCh (temperatura de tono, L*, C*) redactados con los asesores.
2. Personalización: el centro de L* y C* se desplaza un 30 % hacia los valores V y S del usuario.
3. `best`: los 24 colores mejor puntuados, diversificados por tono (máximo 3 por sector de 30°).
4. `avoid`: los 12 peores con C* > 20.
5. `neutrals`: 8 colores con C* < 15 y temperatura compatible.
6. `metal`: oro si T > +0,3; plata si T < −0,3; mixto u oro rosa en medio.

### Puntuación de una prenda

La prenda se segmenta y se reducen sus colores a k ≤ 5 dominantes c_j con fracción de área a_j (k-means en Lab).

```
d_best(j)  = min_p ΔE00(c_j, p)   para p en best ∪ neutrals
d_avoid(j) = min_q ΔE00(c_j, q)   para q en avoid

s_j = exp(−(d_best(j) / 12)²) − 0,5 · exp(−(d_avoid(j) / 8)²)

G = clip( Σ_j a_j · s_j , 0, 1 )            # afinidad de color de la prenda
```

Peso por cercanía a la cara, calculado sobre la prenda puesta en el avatar (d = distancia de cada vértice a la barbilla, promedio ponderado por área):

```
w = media_área( exp(−d / 35 cm) )
```

Valores por defecto cuando no hay avatar: pañuelo, cuello o pendientes 1,0; camiseta, camisa o jersey 0,9; vestido 0,8; chaqueta o abrigo 0,7; falda o pantalón 0,25; calzado 0,1.

```
color_score = 1 − w · (1 − G)               # entra con peso 0,3 en el ranking
outfit_color = Σ_g w_g · G_g / Σ_g w_g
```

Así un pantalón en un color «a evitar» casi no penaliza y una camiseta sí. Los valores 12 y 8 de ΔE y los 35 cm son iniciales; se ajustan con rankings de asesores.

El color de la prenda también depende de la luz: en fotos de tienda se asume sRGB correcto; en fotos del usuario se reutiliza el folio o la referencia A4 del módulo de fit.

## 6. Sesgo por tono de piel

Validar con un dataset propio estratificado por la escala Monk (MST 1–10) y con verdad de color medida, porque los datasets públicos solo sirven para evaluar la segmentación.

| Dataset | Contenido | Licencia | Uso posible |
|---|---|---|---|
| MST-E (Google) | 1515 imágenes y 31 vídeos de 19 personas, MST 1–10 | Solo investigación y formación de anotadores; prohibido entrenar; imágenes © TONL | Evaluar segmentación; consultar si la evaluación comercial está cubierta |
| Casual Conversations v2 (Meta) | Vídeos con Fitzpatrick y Monk | «Limitada»; evaluar sí, entrenar solo con algunas etiquetas; texto completo sin verificar | Evaluación |
| FACET (Meta) | 32 000 imágenes, tono Monk | Solo evaluación, con acuerdo firmado | Evaluación |
| FairFace | Caras con raza, sexo y edad (sin tono de piel) | CC BY 4.0 | Entrenamiento y evaluación de segmentación |
| Fitzpatrick17k | Dermatología | CC BY-NC-SA 4.0 (una sola fuente) | No sirve |
| SCIN (Google) | Dermatología, Fitzpatrick | Fuentes contradictorias | No sirve |

Ninguno tiene estación ni color medido con instrumento.

### Protocolo de validación

1. Reclutar 150–200 voluntarios con cuota por MST: al menos 15 por tono, agrupables en 1–3, 4–6 y 7–10.
2. Por persona: tono MST por dos anotadores, selfie con folio en 2 luces y 2–3 móviles, foto con carta de color, lectura de colorímetro en mejilla y frente si hay presupuesto, y etiqueta de 3 asesores.
3. Métricas por grupo: IoU de piel y pelo, ΔE00 de piel frente a la referencia, tasa de avisos y repeticiones, coincidencia de estación, calibración de la confianza y distribución de estaciones predichas.
4. Criterios: diferencia entre grupos ≤ 10 puntos en coincidencia y ≤ 1,5 en ΔE00; ningún grupo con más del 60 % de sus personas en una sola estación salvo que los asesores digan lo mismo.

Riesgos concretos en piel oscura: subexposición (más ruido en a* y b*), colapso hacia «invierno/otoño profundo» porque el eje de valor domina, y contraste siempre «bajo» si se mide solo con L*. La normalización de T y S por tramo de claridad es la mitigación principal; si no basta, prototipos por tramo.

Los asesores también pueden estar sesgados (el sistema de estaciones nació para piel clara): incluir asesores con experiencia en piel oscura y analizar su acuerdo por grupo.

## 7. Formato de salida

Devolver un objeto `ColorProfile` con solo valores calculados; el selfie se borra al terminar (RGPD) y el tono de piel se trata como dato sensible con consentimiento explícito.

Propuesta para `packages/contracts` (a acordar con quien defina los contratos):

```ts
type Season =
  | "light_spring" | "warm_spring" | "bright_spring"
  | "light_summer" | "cool_summer" | "soft_summer"
  | "soft_autumn" | "warm_autumn" | "deep_autumn"
  | "deep_winter" | "cool_winter" | "bright_winter";

interface ColorProfile {
  season: Season;
  alternatives: { season: Season; probability: number }[]; // hasta 2
  undertone: "warm" | "neutral" | "cool";
  value: "light" | "medium" | "deep";
  chroma: "soft" | "medium" | "bright";      // intensidad
  contrast: "low" | "medium" | "high";
  scores: { temperature: number; value: number; chroma: number; contrast: number }; // T, V, S en z; K en ΔL*
  best: string[];       // hex sRGB, 24
  avoid: string[];      // hex sRGB, 12
  neutrals: string[];   // hex sRGB, 8
  metal: "gold" | "silver" | "mixed";
  confidence: number;   // 0–1
  measurements: {
    skin: { L: number; a: number; b: number };
    hair?: { L: number; a: number; b: number; dyed: boolean };
    eyes?: { L: number; a: number; b: number };
    ita: number;
    skinHue: number;    // grados
  };
  quality: { flags: string[]; captureScore: number };
  algorithmVersion: string;
  createdAt: string;    // ISO 8601
}
```

## 8. Riesgos

- Luz real: si la repetibilidad entre móviles no baja de ΔE00 3, el subtono no es fiable y hay que exigir carta de color impresa o limitar el resultado a 4 estaciones.
- Techo humano: los asesores pueden discrepar entre sí más del 25 %.
- Filtros de belleza y maquillaje: no se detectan bien; dependen de la instrucción al usuario.
- Pelo teñido, canas, velo, calvicie: frecuentes; el clasificador debe funcionar solo con piel y ojos.
- Segmentador: peor en algunos tonos (71,9 de IoU en el peor grupo); medir en nuestro dataset.

## 9. Fuentes

Abiertas o consultadas en esta sesión:

- Ficha del modelo MediaPipe Multiclass Segmentation (PDF, leído completo): https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf
- Lista de modelos de MediaPipe: https://github.com/google/mediapipe/blob/master/docs/solutions/models.md
- jonathandinu/face-parsing: https://huggingface.co/jonathandinu/face-parsing
- EasyPortrait: https://github.com/hukenovs/easyportrait
- Sapiens: https://huggingface.co/facebook/sapiens-seg-1b · Sapiens2: https://huggingface.co/facebook/sapiens2-seg-1b
- Deep Armocromia: https://github.com/lorenzo-stacchio/Deep-Armocromia · https://mlanthology.org/eccvw/2024/stacchio2024eccvw-deep
- MST-E: https://arxiv.org/abs/2305.09073 · https://research.google/blog/consensus-and-subjectivity-of-skin-tone-annotation-for-ml-fairness/
- Casual Conversations v2: https://ai.meta.com/datasets/casual-conversations-v2-dataset/
- FACET: https://arxiv.org/pdf/2309.00035
- SCIN: https://research.google/blog/scin-a-new-resource-for-representative-dermatology-images/
- Color con móviles: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7662536/ · https://arxiv.org/abs/2512.21988
- ITA y sus límites: https://arxiv.org/pdf/2308.09640 · https://arxiv.org/pdf/2309.05148 · https://arxiv.org/pdf/2202.02832

No se pudo abrir skintone.google (fuera de la red permitida de la sesión): los términos de MST-E vienen del artículo y del blog de Google. Los datos de la mayoría de licencias proceden de resultados de búsqueda, no del texto legal; hay que leer cada licencia antes de usar el recurso.
