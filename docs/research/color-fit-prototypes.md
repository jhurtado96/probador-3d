# Prototipos de colorimetría y fit (fase 0)

Diseño detallado en `color.md` y `fit.md`. Cada prototipo dura 3 semanas, los dos pueden ir en paralelo y cada uno termina con una decisión de seguir, ajustar el alcance o parar.

## 1. Resumen

Hacer primero, en ambos módulos, el experimento que mide el error físico (color tras corregir la luz; centímetros de la prenda por foto), porque si ese error no baja del umbral nada de lo que va encima es fiable.

| Módulo | Pregunta que decide | Umbral |
|---|---|---|
| Color | ¿El mismo usuario obtiene el mismo color con otro móvil y otra luz? | ΔE00 mediana ≤ 3 |
| Color | ¿La estación coincide con los asesores? | ≥ 75 % (ver matiz en 2.3) |
| Fit | ¿La foto mide como la cinta métrica? | Error medio ≤ 1,5 cm |
| Fit | ¿Distinguimos oversize de diseño de talla mayor? | ≥ 85 % |

## 2. Prototipo de colorimetría

Construir un cuaderno de Python más una pantalla de captura mínima, y validarlo con 60 voluntarios y 3 asesores antes de escribir código de producto.

### 2.1 Semana 1: captura y medida

- Script: lectura con perfil ICC, detección del folio, corrección de blanco, MediaPipe (landmarks y segmentador multiclase), medidas Lab de piel, pelo y ojos, avisos de calidad.
- Datos: 25 personas × 2 luces (ventana, interior) × 3 móviles (un iPhone, un Android de gama alta, uno de gama media) × 3 disparos, con folio y con carta de color en la escena.
- Referencia: color de piel calculado con la carta de color (matriz de corrección completa).

| Métrica | Umbral |
|---|---|
| ΔE00 de piel con folio frente a la referencia con carta | mediana ≤ 4, percentil 90 ≤ 7 |
| Repetibilidad entre móviles y luces (misma persona) | mediana ≤ 3 |
| Desviación del tono de piel (h) entre capturas | ≤ 3° |
| Capturas rechazadas por los avisos con luz aceptable | ≤ 20 % |
| Capturas malas que pasan los avisos | ≤ 5 % |

Si la repetibilidad queda entre 3 y 5: exigir luz de día y promediar más disparos. Si pasa de 5: plan B (tarjeta de color impresa enviada o descargable, o resultado limitado a 4 estaciones).

### 2.2 Semana 2: clasificación y etiquetas

- Ampliar a 60 personas (al menos 5 por cada tono Monk, 1–10) con selfie con folio.
- 3 asesores etiquetan cada persona de forma independiente (estación de 12, segunda opción, subtono, valor, intensidad).
- Implementar los prototipos (T, V, S), ajustar la referencia de tono por claridad y los centros con validación cruzada por persona.

| Métrica | Umbral |
|---|---|
| Acuerdo entre asesores (12 estaciones) | Se informa; es el techo |
| Coincidencia exacta con el consenso, 12 estaciones | ≥ 75 %, o como mínimo el acuerdo medio asesor–asesor menos 5 puntos |
| Coincidencia con la primera o segunda opción de algún asesor | ≥ 85 % |
| Coincidencia en 4 estaciones | ≥ 85 % |
| Subtono (cálido, neutro, frío) | ≥ 80 % |
| Misma estación en capturas repetidas de la misma persona | ≥ 80 % |
| Confianza calibrada (error de calibración esperado) | ≤ 0,10 |

### 2.3 Sobre el 75 %

El 75 % del plan solo tiene sentido si los asesores coinciden entre sí por encima de esa cifra. Con 60 personas el intervalo de confianza es de ± 11 puntos, así que en fase 0 el resultado es orientativo; la validación firme necesita las 150–200 personas de `color.md`.

### 2.4 Semana 3: paleta, prendas y sesgo

- Generar paleta y puntuar 30 prendas por persona para 20 personas; los asesores ordenan las mismas prendas.
- Auditoría por grupos de tono Monk (1–3, 4–6, 7–10).
- Emitir `ColorProfile` en JSON con el esquema propuesto.

| Métrica | Umbral |
|---|---|
| Paletas que el asesor considera adecuadas | ≥ 80 % |
| Correlación de rangos (Spearman) entre puntuación y asesor | ≥ 0,6 |
| Diferencia de coincidencia entre grupos de tono | ≤ 10 puntos |
| Diferencia de ΔE00 entre grupos de tono | ≤ 1,5 |
| IoU de piel y pelo en el peor grupo | ≥ 0,75 |
| Tiempo de proceso en móvil de gama media | ≤ 3 s |

### 2.5 Datos y recursos

- 60 voluntarios con consentimiento explícito (fotos de cara y tono de piel; las fotos del estudio se guardan bajo un consentimiento de investigación distinto del de producto).
- 3 asesores de imagen, unas 10 horas cada uno, con un protocolo escrito de 12 estaciones.
- Una carta de color (tipo ColorChecker) y 3 móviles.
- Opcional: colorímetro de piel alquilado.

## 3. Prototipo de fit

Construir primero la medición por foto con A4 y validarla contra cinta métrica en 40 prendas; después la base de tablas, el motor de holgura y el clasificador de fit de diseño.

### 3.1 Semana 1: medición por foto

- Script: detección del A4, homografía, segmentación de la prenda, medidas por contorno (línea base) y por puntos corregidos a mano.
- Datos: 40 prendas (8 por categoría: camiseta, camisa, chaqueta, pantalón, vestido) × 3 fotos (cenital, inclinada 10°, otra persona y otro móvil).
- Referencia: cinta métrica por dos personas; su diferencia es el suelo de error.

| Métrica | Umbral |
|---|---|
| Error de escala (lado del A4 medido en otra posición de la imagen) | ≤ 1 % |
| Error medio en anchos (pecho, cintura, cadera, bajo), puntos corregidos | ≤ 1,5 cm |
| Error medio en largos y manga | ≤ 2 cm |
| Medidas dentro de ± 2 cm | ≥ 90 % |
| Percentil 90 del error | ≤ 3 cm |
| Error medio totalmente automático (línea base de contorno) | ≤ 2,5 cm (informativo) |
| Repetibilidad entre fotos de la misma prenda | ≤ 1 cm |

Si los puntos corregidos a mano no llegan a 1,5 cm, el problema es de captura (extender la prenda, perspectiva) y no de modelo: reforzar la guía o pasar a LiDAR.

### 3.2 Semana 2: tablas, holgura y clasificador

- Base de tablas: 30 marcas × 5 categorías, curadas a mano con URL y fecha; anotar cuáles dan medidas de prenda.
- Motor de holgura con los umbrales iniciales y propagación de incertidumbre.
- Clasificador de fit de diseño: 1000 productos con etiqueta débil del texto y 200 de referencia etiquetados a mano por dos personas.
- Conjunto difícil: 60 casos (la misma prenda en su talla y en una o dos más, junto a prendas oversize de diseño).

| Métrica | Umbral |
|---|---|
| Marcas con tabla de cuerpo completa | ≥ 25 de 30 |
| Marcas con medidas de prenda por producto | Se informa (es el dato que decide el alcance) |
| Acuerdo entre los dos anotadores (kappa) | ≥ 0,7 |
| Macro-F1 del fit de diseño, 4 clases, partición por marca | ≥ 0,80 |
| Oversize de diseño frente a talla mayor, conjunto difícil | ≥ 85 % (las reglas solas ≥ 75 %) |
| Error de la prenda estimada desde tabla de cuerpo frente a medida real | Se informa; se espera ± 3–4 cm |

### 3.3 Semana 3: de extremo a extremo con usuarios

- 15–20 personas con avatar o, si el módulo de avatar no está listo, medidas de cuerpo con cinta.
- Cada persona aporta 5 prendas propias con marca y talla y dice cómo le queda cada zona (apretado, bien, holgado) y si es su talla.
- Preferencia: se entrena con 5 opiniones y se evalúa con otras prendas.

| Métrica | Umbral |
|---|---|
| Etiqueta por zona (3 niveles) frente a la percepción del usuario | ≥ 75 % |
| Talla recomendada igual a la que el usuario considera suya | ≥ 70 % exacta, ≥ 95 % a ± 1 talla |
| Error de la holgura preferida tras 5 opiniones | ≤ 3 cm de media |
| Casos en que la banda de incertidumbre abarca más de dos niveles | ≤ 30 % |

### 3.4 Datos y recursos

- 40 prendas para medir y 2 personas con cinta métrica.
- Curación de 30 marcas (unas 20 horas) y 1200 fichas de producto.
- 2 anotadores con formación en patronaje, unas 8 horas cada uno.
- 15–20 voluntarios con 5 prendas cada uno.
- Revisión legal breve del método de recogida de tablas antes de automatizar nada.

## 4. Decisión al terminar

Seguir con el módulo si cumple los umbrales físicos de la semana 1 y al menos dos tercios del resto; si falla la semana 1, cambiar el método de captura antes de invertir en modelos.

| Resultado | Decisión |
|---|---|
| Color: repetibilidad ≤ 3 y coincidencia ≥ objetivo | Pasa al MVP con 12 estaciones |
| Color: repetibilidad 3–5 o coincidencia de 12 estaciones baja pero 4 estaciones ≥ 85 % | MVP con 4 estaciones y subtono; 12 estaciones cuando haya dataset |
| Color: repetibilidad > 5 | Referencia de color mejor (tarjeta impresa) o asesoría asistida por humano |
| Fit: error ≤ 1,5 cm con puntos corregidos | Pasa; el modelo de keypoints se entrena en fase 1–3 con las correcciones |
| Fit: error 1,5–2,5 cm | Solo niveles gruesos de holgura (3 niveles) y talla a ± 1 |
| Fit: pocas marcas con medidas de prenda | MVP de «fit por etiqueta y texto» como dice el plan; medición por foto para el armario |

## 5. Entregables

- `color`: cuaderno y script reproducibles, tabla de resultados por móvil, luz y grupo de tono, prototipos ajustados, ejemplos de `ColorProfile`.
- `fit`: script de medición, base de tablas de 30 marcas con procedencia, motor de holgura, clasificador con informe por marca, informe de usuarios.
- Un registro de licencias leídas (texto legal, fecha y decisión) para cada modelo y dataset usado.
