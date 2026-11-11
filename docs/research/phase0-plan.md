# Plan de la fase 0: prototipos, datos, métricas y go/no-go

Estado: propuesta (2026-11-11). Cubre avatar, prenda y drapeado; colorimetría y fit tienen sus propios documentos (`color.md`, `fit.md`) y se integran en la semana 6.

## 1. Recomendación

Ejecutar **6 semanas con seis prototipos (P0–P5)** y una decisión de go/no-go en la semana 6; propuesta previa: **go condicionado** a que el avatar cumpla el umbral de medidas con foto frontal + perfil o con corrección manual, porque licencias y viabilidad técnica de prenda y drapeado no presentan bloqueos.

La pila propuesta es comercialmente limpia según lo verificado: SAM 3D Body + MHR (avatar), SAM 2 + modelo de visión + GarmentCode (prenda), Newton/Warp (drapeado). Lo que queda por demostrar es calidad, no legalidad: precisión de medidas y aspecto visual del resultado final.

## 2. Prototipos

Lanzar P0 y P1 la primera semana; P2 y P3 en paralelo desde la segunda; P4 integra; P5 evalúa.

| Id | Prototipo | Entregable | Rol · modelo | Semanas |
|---|---|---|---|---|
| **P0** | Auditoría de licencias y datos | Tabla firmada de licencias (texto literal de cada LICENSE y tarjeta de modelo), con los pendientes de este estudio resueltos; solicitud de oferta SMPL-X a Max Planck Innovation y de 2 APIs de medidas | Explorador/a · `haiku` recopila; Revisor/a crítico/a · `fable` valida | 1 |
| **P1a** | Avatar base | Worker Python: foto + altura → SAM 3D Body → MHR → GLB + medidas. Librería de medición independiente de topología con pruebas unitarias | Investigador/a ML · `opus` | 1–2 |
| **P1b** | Ajuste de forma | Optimizador con altura, silueta, segunda vista opcional y corrección por medidas; comparación con y sin ajuste | Investigador/a ML · `fable` diseña la función de coste, `opus` implementa | 2–4 |
| **P1c** | Evaluación de medidas | Protocolo de captura y medición, conjunto de voluntarios, informe de MAE por medida y subgrupo; prueba de 1–2 APIs comerciales con el mismo conjunto | QA · `sonnet` (arnés e informe); captura y cinta: personas | 2–5 |
| **P2a** | Prenda: segmentación y atributos | Foto → máscara (SAM 2) → JSON de atributos validado por esquema; evaluación sobre el conjunto de prendas | Investigador/a ML · `opus`; etiquetado masivo de referencia · `haiku` con revisión humana | 2–3 |
| **P2b** | Prenda: plantilla y textura | 5 categorías de GarmentCode, ajuste de parámetros por silueta, textura en modos material y proyección, GLB con UV. Confirmar que `pygarment` genera malla sin el fork no comercial | Investigador/a ML · `opus`; Ingeniero/a 3D · `opus` para UV y GLB | 3–5 |
| **P2c** | Nivel 2 exploratorio | Modelo de visión → parámetros completos de GarmentCode sin entrenamiento, comparado con ChatGarment en 20 fotos (solo evaluación interna) | Investigador/a ML · `fable` | 5 (acotado a 3 días) |
| **P3a** | Drapeado base | Patrón + cuerpo → cosido y relajación en Newton (`SolverStyle3D` y `SolverVBD`) y, como comparación, Warp XPBD; métricas de tiempo e intersecciones | Investigador/a ML · `fable` diseña cosido y colisiones, `opus` implementa | 2–4 |
| **P3b** | Caché y reajuste | Clave de caché, cuantización del cuerpo, reajuste entre cuerpos cercanos; medir hasta qué diferencia de medidas es aceptable | Backend · `sonnet`; Investigador/a ML · `opus` para el reajuste | 4–5 |
| **P4** | Demostración integrada | Visor React Three Fiber: avatar + 2 prendas (superior e inferior) drapeadas, en web y en un móvil de gama media; rendimiento medido | Ingeniero/a 3D · `opus`; Frontend · `sonnet` | 5–6 |
| **P5** | Evaluación y go/no-go | Panel de calidad visual, informe final con métricas frente a umbrales y recomendación | Arquitecto/a · `fable`; QA · `sonnet` prepara datos | 6 |

Calendario resumido:

| Semana | Foco |
|---|---|
| 1 | P0, arranque de P1a, protocolo de captura y reclutamiento de voluntarios |
| 2 | P1a cerrado; P1b, P2a y P3a en marcha |
| 3 | P2b; primeras medidas reales (P1c) |
| 4 | Punto de control: MAE de medidas con una foto; decidir si se activa el plan B (API) en paralelo. P3a cerrado |
| 5 | P2b cerrado, P3b, P2c, P4 |
| 6 | P4 cerrado, P5, decisión |

Versión de 4 semanas si hay que recortar: quitar P2c y P3b, limitar P2b a 3 categorías y modo material, y P4 a web.

## 3. Datos de prueba

Basar la decisión en datos propios con consentimiento y usar conjuntos públicos solo donde su licencia lo permita.

| Conjunto | Uso | Licencia | Estado |
|---|---|---|---|
| **Voluntarios propios** (30–40 personas; frontal, perfil, ropa ajustada y holgada; altura, peso, 10 medidas de cinta ×2) | Métrica principal del avatar | Propio; consentimiento RGPD específico, fotos borradas al cerrar la fase 0 salvo consentimiento de conservación | Por crear (semana 1–3). Equilibrar sexo, IMC 18–35+, Fitzpatrick I–VI |
| **Cuerpos sintéticos** (500 muestras MHR/Anny renderizadas con medidas conocidas) | Prueba de ida y vuelta del ajuste y la medición | MHR Apache 2.0, Anny Apache 2.0/CC0 (verificado) | Por generar |
| BodyM (Amazon; 2.505 sujetos, siluetas + 14 medidas) | Evaluación interna a escala del ajuste por silueta | CC BY-NC 4.0 (visto en buscador): **solo evaluación, nunca entrenamiento**; confirmar con legal en P0 | Público en AWS Open Data |
| ANSUR II (tablas de medidas) | Prior y comprobación de plausibilidad | Datos públicos del ejército de EE. UU.; términos por confirmar en P0 | Público |
| **Prendas propias** (60 prendas, 5 categorías × 12; foto extendida y en percha, medidas con cinta, talla y marca) | Métrica principal de prenda | Propio | Por crear (semana 2–3) |
| Fashionpedia (27 categorías, 294 atributos) | Evaluación de atributos | CC BY 4.0 en anotaciones (de memoria); imágenes con licencias mixtas: confirmar en P0 | Público |
| GarmentCodeData | Patrones de ejemplo para probar el drapeado | Sin confirmar (CC BY-SA 4.0 o CC BY-NC): confirmar en P0; mientras tanto generar patrones propios con GarmentCode (MIT) | — |
| DeepFashion2, HBW, SSP-3D, SewFactory | — | Solo investigación o sin licencia: **no usar** | Descartados |

## 4. Métricas y umbrales

Decidir con los umbrales de esta tabla; "ámbar" obliga a un plan de mitigación escrito y "no-go" detiene el módulo.

| Área | Métrica | Go | Ámbar | No-go |
|---|---|---|---|---|
| Avatar | MAE de pecho, cintura y cadera (voluntarios, frontal + perfil, ropa ajustada) | < 3,0 cm | 3,0–4,5 cm | > 4,5 cm |
| Avatar | Igual con una sola foto frontal | < 4,0 cm | 4,0–6,0 cm | > 6,0 cm |
| Avatar | MAE de longitudes (entrepierna, brazo, hombros) | < 2,0 cm | 2,0–3,0 cm | > 3,0 cm |
| Avatar | Diferencia de MAE entre subgrupos (sexo, IMC, tono de piel) | < 1,0 cm | 1,0–2,0 cm | > 2,0 cm |
| Avatar | Repetibilidad (3 fotos de la misma persona), desviación típica de perímetros | < 1,0 cm | 1,0–2,0 cm | > 2,0 cm |
| Avatar | Latencia p95 en L4, sin arranque en frío | < 20 s | 20–40 s | > 40 s |
| Avatar | Tasa de fallo en fotos que pasan la validación de captura | < 5 % | 5–10 % | > 10 % |
| Prenda | Acierto de categoría / media de atributos | > 95 % / > 85 % | > 90 % / > 75 % | por debajo |
| Prenda | IoU de silueta plantilla–foto | > 0,85 | 0,75–0,85 | < 0,75 |
| Prenda | MAE de medidas de prenda (ancho, largo, manga) con escala conocida | < 2,0 cm | 2,0–3,5 cm | > 3,5 cm |
| Prenda | "Reconozco mi prenda" (panel ciego de 5 personas, 1–5) | media ≥ 3,5 | 3,0–3,5 | < 3,0 |
| Drapeado | Tiempo por prenda en L4 (15 k triángulos) | < 20 s | 20–60 s | > 60 s |
| Drapeado | Simulaciones sin intersección visible cuerpo–tela ni costuras abiertas | > 95 % | 85–95 % | < 85 % |
| Drapeado | Realismo (panel ciego, 1–5, frente a foto de la prenda puesta) | media ≥ 3,5 | 3,0–3,5 | < 3,0 |
| Visor | Fotogramas por segundo en móvil de gama media con avatar + 2 prendas | ≥ 30 | 20–30 | < 20 |
| Visor | Peso de descarga de la escena | < 6 MB | 6–12 MB | > 12 MB |
| Licencias | Componentes de producción con licencia comercial verificada por escrito | 100 % | — | cualquiera sin resolver |

## 5. Regla de decisión

Decidir "go" si no hay ningún no-go y el avatar está en go por alguna de sus tres vías; en otro caso aplicar la salida indicada.

- **Go**: ningún no-go y medidas de avatar < 3 cm con (a) pipeline propio de una foto, (b) pipeline propio con frontal + perfil, o (c) API comercial con contrato viable.
- **Go con alcance reducido**: avatar en ámbar → el MVP sale con frontal + perfil obligatorio y corrección manual de 3–4 medidas, y la recomendación de talla se muestra como orientativa.
- **Go con plan B**: pipeline propio en no-go y API comercial en go → integrar la API para medidas y ajustar nuestro cuerpo a ellas; renegociar coste por usuario.
- **No-go parcial de prenda o drapeado**: el MVP usa plantillas con menos categorías o drapeado precalculado por talla sobre cuerpos estándar, y se repite el prototipo.
- **No-go global**: calidad visual integrada (P4) con media < 3,0 en el panel y sin mejora clara identificada.

**Propuesta de este estudio antes de ejecutar**: go condicionado. Riesgo alto: precisión de perímetros con una sola foto y ropa normal (la literatura no publica cifras para los modelos con licencia comercial). Riesgo medio: textura de prendas con arrugas y sombras; estabilidad de autocolisión en Newton. Riesgo bajo: licencias del camino principal.

## 6. Pendientes que P0 debe cerrar

Resolver en la primera semana lo que este estudio no pudo abrir por restricciones de red.

1. Texto de la licencia del checkpoint Multi-HMR + Anny (download.europe.naverlabs.com).
2. Texto de la licencia SMPL-X y oferta comercial de Max Planck Innovation (smpl-x.is.tue.mpg.de).
3. Licencia de GarmentCodeData (ETH Research Collection), de los pesos de ChatGarment, Sewformer y SMPLest-X (Hugging Face) y de los pesos de BiRefNet.
4. Revisión legal de la SAM License (cambios unilaterales, indemnización) y de si evaluar con datos CC BY-NC es admisible.
5. Dependencia real de `pygarment` respecto a `NvidiaWarp-GarmentCode`.
6. Precios y condiciones RGPD de Bodygram y 3DLOOK.

Hosts que habría que permitir en la red de la sesión para repetir la verificación: arxiv.org, huggingface.co, smpl-x.is.tue.mpg.de, download.europe.naverlabs.com, www.research-collection.ethz.ch, newton-physics.github.io, www.mpg.de, dev.to, www.prismlabs.tech.

## Fuentes

Las de `avatar.md`, `garment.md` y `drape.md`; los roles y modelos de agente siguen `.claude/skills/probador-3d-multiagente/SKILL.md`.
