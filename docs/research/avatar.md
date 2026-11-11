# Avatar: foto de cuerpo entero + altura → cuerpo paramétrico + medidas

Estado: diseño de fase 0 (2026-11-11). Nivel de verificación de cada dato: **[V]** fuente primaria abierta en esta sesión, **[S]** solo resumen de buscador, **[M]** memoria del autor, sin verificar. Lo marcado [S] o [M] debe confirmarse antes de firmar nada.

## 1. Recomendación

Usar **SAM 3D Body (Meta) → MHR (Momentum Human Rig)** como estimador y modelo corporal, con un **ajuste de forma propio** condicionado a la altura declarada y a la silueta, y medir sobre la malla en pose canónica; no usar SMPL-X en producción salvo que se firme licencia con Max Planck Innovation.

Motivos:

- Es la única combinación estimador + pesos + modelo corporal cuya licencia permite uso comercial y que hemos podido verificar: código y pesos bajo "SAM License" (uso y redistribución permitidos, sin cláusula no comercial; prohíbe usos militares, nucleares, espionaje, armas e ITAR) [V], y MHR bajo Apache 2.0 [V].
- Todos los estimadores "clásicos" del plan (SMPLer-X, HMR 2.0, Multi-HMR, TokenHMR, CameraHMR, NLF) dependen de SMPL/SMPL-X (no comercial sin licencia) y la mayoría tiene además código o pesos no comerciales (tabla 2).
- Ningún estimador publica precisión de medidas corporales en cm: todos se evalúan en pose (MPJPE/PVE). La forma hay que resolverla nosotros con el ajuste del apartado 4, sea cual sea el estimador. Por eso el objetivo "< 3 cm" es el principal riesgo de la fase 0 y no se da por hecho.

Decisión de arquitectura asociada: el resto del sistema **no debe depender de la topología del cuerpo**. El contrato del avatar es: malla GLB + esqueleto + vector de forma + tabla de medidas en cm + nombre y versión del modelo corporal. Así se puede cambiar MHR por Anny o SMPL-X sin tocar prenda ni drapeado. SOMA-X (NVIDIA, Apache 2.0) ofrece ya una capa común sobre MHR, Anny, SMPL-X y el cuerpo de GarmentCode ("GarmentMeasurements") [V]; evaluarla como adaptador en el prototipo P1.

## 2. Estimadores candidatos

Usar SAM 3D Body como primera opción y Multi-HMR con Anny como segunda solo si su licencia de pesos resulta comercial.

| Candidato | Modelo de salida | Licencia código | Licencia pesos | Forma corporal publicada | Coste / latencia |
|---|---|---|---|---|---|
| **SAM 3D Body** (Meta, CVPR 2026) | MHR | SAM License: comercial permitido con restricciones de uso [V] | Igual que el código [V] | Sin métrica de forma; 3DPW MPJPE 54,8 mm, RICH PVE 60,3 mm [V] | Backbones de 631 M (ViT-H) y 840 M (DINOv3-H+) de parámetros [V]; latencia no publicada, medir en P1 (estimación propia: 1–3 s en L4/A10) |
| **Multi-HMR + Anny** (NAVER, checkpoint `multiHMR_672_L_anny`, 2026-02) | Anny | "Multi-HMR Non-Commercial License": **no comercial** [V] | Licencia propia del checkpoint Anny, alojada en download.europe.naverlabs.com: **no se pudo abrir** | Sin métricas publicadas para ese checkpoint [V] | Variante 672_L con SMPL-X: 74 ms en V100 [V] |
| Multi-HMR (SMPL-X) | SMPL-X | No comercial [V] | No comercial [V] | PVE EHF 37,0 mm (672_L) [V] | 29–126 ms en V100 [V] |
| SMPLer-X / SMPLest-X | SMPL-X | Fichero LICENSE no legible desde aquí; S-Lab License, no comercial [M] | Igual [M] | Solo pose | 17–36 fps en V100 [V] |
| HMR 2.0 (4D-Humans) | SMPL | MIT [V] | No declarada [V] | Solo pose; forma débil [M] | Rápido (ViT-H) |
| TokenHMR | SMPL | Solo investigación no comercial; comercial vía ps-licensing@tue.mpg.de [V] | Igual [V] | Solo pose | — |
| CameraHMR | SMPL / SMPL-X | No declarada en el README; pesos tras registro en MPI [V] | Registro MPI [V] | No publicada en el README [V] | — |
| NLF | SMPL / puntos | MIT [V] | "noncommercial research use" [V] | No publicada [V] | — |
| SHAPY | SMPL-X | Investigación; comercial vía MPI [S] | Igual [S] | Único con métrica de forma: error de altura 51 mm en HBW [S] | — |

Conclusión: de la lista, solo SAM 3D Body pasa el filtro de licencia hoy. HMR 2.0 tiene código MIT, pero pesos sin licencia declarada y salida SMPL.

## 3. Modelos corporales

Adoptar MHR como modelo de fase 0 y mantener Anny como alternativa abierta; tratar SMPL-X como formato de intercambio opcional, no como dependencia.

| Modelo | Licencia | Parámetros de forma | Notas |
|---|---|---|---|
| **MHR** (Meta) | Apache 2.0 [V] | 45 de identidad: 20 cuerpo, 20 cabeza, 5 manos; 7 niveles de detalle [V] | Salida nativa de SAM 3D Body. Incluye conversión MHR ↔ SMPL/SMPL-X en ambos sentidos (requiere los ficheros SMPL-X, con su licencia) [V] |
| **Anny** (NAVER) | Código Apache 2.0; datos CC0 (MakeHuman/MPFB2) [V] | Fenotipos interpretables en [0,1]; cubre de bebés a ancianos [V] | Sin registro. v0.6.2 del 2026-10-26, en desarrollo activo. Su topología `smplx` es solo no comercial; usar la topología `anny` [V]. No nace de escáneres: comprobar en P1 si expresa bien cuerpos reales |
| SMPL-X | No comercial; licencia comercial de pago | 10–300 betas | Tras la compra de Meshcapade por Epic Games (2026-02-18), la licencia la gestiona Max Planck Innovation [S]. Precios públicos contradictorios (de 2.000 €/año a más de 100.000 €) [S]: pedir oferta formal. Un resumen de terceros dice que la licencia prohíbe entrenar redes para uso comercial [S]; no pudimos abrir el texto (smpl-x.is.tue.mpg.de bloqueado) |
| SOMA-X (NVIDIA) | Apache 2.0, "ready for commercial use" [V][S] | PCA propio + adaptadores | Capa de unificación, no sustituye a los anteriores |

Impacto en otros módulos: HOOD y ContourCraft exigen SMPL [V]; GarmentCode usa su propio cuerpo definido por medidas. La simulación física solo necesita una malla de colisión, así que MHR o Anny sirven (ver `drape.md`).

## 4. Pipeline propuesto

Implementar cinco pasos en un único worker GPU, con la foto solo en memoria y borrada al terminar.

1. **Validación de captura** (cliente y servidor): MediaPipe Pose comprueba cuerpo entero, de frente, brazos algo separados (pose A), cámara a la altura de la cintura. Rechazar con mensaje concreto. Pedir ropa ajustada; ofrecer una **segunda foto de perfil opcional**.
2. **Segmentación de persona**: SAM 2 (Apache 2.0 [V]) con la caja del detector → silueta.
3. **Estimación inicial**: SAM 3D Body → pose, forma MHR y cámara.
4. **Ajuste de forma** (optimización, 100–300 iteraciones, diferenciable): se optimizan forma, pose fina, escala y cámara minimizando
   - reproyección de puntos clave 2D,
   - error de silueta (IoU suave o distancia de contorno) en la vista frontal y, si existe, en la de perfil, compartiendo la misma forma,
   - **restricción dura de altura**: la estatura de la malla en pose canónica debe ser igual a la declarada (no escalar la malla de forma uniforme: infla o encoge los perímetros),
   - opcional: peso declarado como restricción blanda sobre el volumen (densidad ≈ 985 kg/m³, valor a calibrar),
   - prior de forma (penalización sobre los coeficientes) para no salir del espacio plausible,
   - corrección de ropa: la silueta vestida es una cota superior; penalizar más que el cuerpo sobresalga de la silueta que el caso contrario.
5. **Medición y salida**: malla en pose A canónica → medidas (apartado 5) → GLB + JSON. Se guardan parámetros y medidas, nunca la foto.

Corrección por el usuario: permitir editar 3–4 medidas (pecho, cintura, cadera, tiro) y reajustar la forma a esas medidas con el mismo optimizador. Es la red de seguridad si la foto sola no llega al objetivo.

## 5. Cómo calcular las medidas sobre la malla

Medir siempre en pose A canónica y con definiciones ISO 8559-1, mediante cortes planos y distancias entre puntos de referencia fijados una vez sobre la topología.

- **Perímetros** (pecho, bajo pecho, cintura, cadera, muslo, pantorrilla, bíceps, cuello, muñeca): intersección de la malla con un plano que pasa por un punto de referencia y cuya normal es el eje del hueso o el eje vertical; quedarse con el bucle de la parte del cuerpo correcta (segmentación por vértices) y sumar longitudes. Para pecho y cadera usar además la **envolvente convexa** del corte, que imita la cinta métrica al saltar concavidades. Cintura: probar "mínimo perímetro entre costillas y cresta ilíaca" frente a "altura del ombligo" y fijar una en el contrato.
- **Longitudes** (brazo, entrepierna, hombro a hombro, espalda, tiro): distancia geodésica o suma de segmentos entre puntos de referencia; estatura = extensión vertical.
- **Implementación**: tomar como referencia SMPL-Anthropometry (MIT), que hace exactamente esto para SMPL/SMPL-X con 16 medidas [V], y portar los puntos de referencia a MHR/Anny. La librería debe ser independiente de la topología: recibe vértices, caras, índices de puntos de referencia y etiquetas de parte.
- **Pruebas unitarias**: cilindros y elipsoides de perímetro conocido, y cuerpos sintéticos con medidas fijadas.

## 6. Cómo validar el error (objetivo < 3 cm)

Validar con un conjunto propio de voluntarios medidos con cinta, que es lo único comercialmente limpio y representativo, y usar los conjuntos públicos solo como evaluación interna.

- **Conjunto propio (imprescindible)**: voluntarios con consentimiento explícito, dimensionado **por estrato** (revisión de la fase 0, M8). Con 30–40 personas repartidas en sexo × 3 tramos de IMC × 6 tonos quedan una o dos por celda y no se puede afirmar nada por grupo; por eso cada eje se dimensiona y se analiza por separado:
  - **Tono de piel con la escala Monk** (MST 1–10, la misma que la colorimetría, para poder cruzar resultados; no Fitzpatrick): al menos 15 personas en cada tramo MST 1–3, 4–6 y 7–10.
  - **IMC**: al menos 15 personas en cada tramo (< 25, 25–30, ≥ 30, con representación de ≥ 35, donde los estimadores fallan más).
  - **Sexo**: al menos 20 por sexo.
  - Con solapamiento entre ejes salen **unas 60–70 personas** como mínimo (no 30–40). Cada eje se analiza por separado (MAE e intervalo de confianza por tramo); el cruce completo no se exige.
  - **Diversidad funcional**: al menos 5 personas que no pueden mantener la A-pose de pie (usuarias de silla de ruedas, diferencia de longitud o ausencia de un miembro) para validar los caminos de captura alternativos (abajo).

  Por persona: foto frontal y de perfil con ropa ajustada, foto frontal con ropa holgada, altura, peso y 10 medidas de cinta tomadas dos veces por la misma persona según ISO 8559-1 (la diferencia entre repeticiones da el ruido de la referencia, normalmente 0,5–1,5 cm en perímetros [M]).
- **BodyM** (Amazon): 2.505 sujetos reales, 8.978 siluetas frontal y lateral con altura, peso y 14 medidas; licencia **CC BY-NC 4.0** [S]. Solo evaluación interna y nunca entrenamiento; que legal confirme que evaluar internamente cabe en "no comercial".
- **Sintético**: muestrear cuerpos MHR/Anny con medidas conocidas, renderizarlos y pasar el pipeline completo. Sin problema de licencia; detecta errores del optimizador y de la medición, no la brecha con fotos reales.
- **ANSUR II**: tablas de medidas públicas (sin imágenes ni escáneres públicos) [S]; sirve como prior y para comprobar plausibilidad.
- HBW y SSP-3D: solo investigación (MPI) [M]; no usar.

Métricas: error absoluto medio (MAE) y percentil 90 por medida; desglose por sexo, IMC, tono de piel (Monk) y tipo de ropa; repetibilidad (misma persona, 3 fotos). Umbrales en `phase0-plan.md`, incluido el criterio de lanzamiento por grupo: **MAE del peor tramo ≤ 1,5 × MAE global** en cada eje.

**Captura accesible (M8).** La foto de pie en A-pose excluye a quien no puede mantenerla. Caminos alternativos que la fase 0 debe probar con el grupo de diversidad funcional:
- **Pose sentada**: foto frontal sentado con la altura declarada; el ajuste de forma fija la pose sentada como pose de la foto y mide en la pose canónica. Las longitudes de pierna (entrepierna, tiro) se marcan con incertidumbre alta o se piden a mano.
- **Foto asistida**: otra persona hace la foto con guía por voz y silueta, sin exigir temporizador ni distancia fija.
- **Medidas manuales parciales**: el avatar se puede guardar con las medidas que la persona tenga; las de miembros (`arm_length_cm`, `inseam_cm`) deberían ser opcionales y el fit omite las zonas sin medida (contrato: `FIT_ZONE_BODY_MEASUREMENT`). Hoy `avatars.measurements` exige siete medidas: cambio pendiente de decisión de producto (revisión, M8).

Expectativa realista (estimación propia, a confirmar en P1): longitudes < 2 cm al conocer la altura; perímetros 3–5 cm con una sola foto vestida y 2–3 cm con frontal + perfil y ropa ajustada. El objetivo de 3 cm probablemente exige la segunda foto o la corrección manual.

## 7. Coste GPU y latencia

Dimensionar para una GPU de 24 GB (L4 o A10) y un presupuesto de 10–20 s por avatar de principio a fin; es un trabajo en cola, no interactivo.

Estimación propia, a medir en P1: segmentación < 1 s, SAM 3D Body 1–3 s, ajuste de forma 3–10 s, medición y exportación < 1 s. A unos 0,7–1,0 €/h de L4 sale por debajo de 0,01 € por avatar sin contar arranques en frío; el arranque en frío (carga de 3–4 GB de pesos) será el coste dominante en serverless y conviene mantener los pesos en un volumen.

## 8. Plan B comercial (APIs de terceros)

Mantener como plan B una API de medidas por foto (Bodygram o 3DLOOK) y decidir en la semana 4 según el resultado de P1; ninguna devuelve un cuerpo paramétrico nuestro, así que el avatar se generaría ajustando la forma a las medidas que devuelvan.

| Proveedor | Entrada | Salida | Precio | Notas |
|---|---|---|---|---|
| Bodygram Platform | Fotos frontal + lateral, altura, peso, edad | 35 medidas y composición [S] | No público; cuota por escaneo [S] | API documentada |
| 3DLOOK (Mobile Tailor / FitXpress) | Frontal + lateral | 80+ medidas [S] | No público; 2–5 $ por escaneo según un tercero [S] | Precisión declarada por el proveedor 96–97 % [S], sin auditoría independiente |
| Prism Labs | Captura en vídeo [M] | Medidas y avatar | 2 $/usuario activo, mínimo 500 $/mes [S] | Orientado a fitness |
| True To Form | Fotos | Medidas y avatar | 40 $/mes + 4 $ por escaneo extra [S] | API bajo petición |
| MirrorSize | Fotos | Medidas | 299 $ de alta + a medida [S] | — |
| Meshcapade | — | — | — | Comprada por Epic; servicios online apagados en abril de 2026 según una fuente [S]. Descartada |

Condiciones para activar el plan B: contrato de encargo de tratamiento (RGPD), procesamiento en la UE o garantías equivalentes, borrado de fotos garantizado y prueba con nuestro conjunto de voluntarios (mismo umbral de 3 cm). Coste por usuario dos órdenes de magnitud superior al pipeline propio.

## 9. Riesgos abiertos

- La SAM License no es una licencia abierta estándar: Meta puede modificarla y exige indemnización [V]; revisión legal antes del MVP.
- Licencia del checkpoint Multi-HMR + Anny sin verificar (host bloqueado).
- Sesgo: validar por tono de piel (Monk) e IMC con el tamaño de muestra por estrato del apartado 6; los estimadores fallan más en cuerpos grandes y ropa holgada [M].
- Hosts no accesibles desde esta sesión, que impidieron verificar fuentes: smpl-x.is.tue.mpg.de, arxiv.org, huggingface.co, download.europe.naverlabs.com, dev.to, www.mpg.de, www.prismlabs.tech.

## Fuentes

Abiertas [V]:
- https://github.com/facebookresearch/sam-3d-body y su fichero LICENSE
- https://github.com/facebookresearch/MHR y `tools/mhr_smpl_conversion/README.md`
- https://github.com/naver/anny
- https://github.com/naver/multi-hmr y `LICENSE.txt` (rama master)
- https://github.com/NVlabs/SOMA-X
- https://github.com/caizhongang/SMPLer-X , https://github.com/SMPLCap/SMPLest-X
- https://github.com/shubham-goel/4D-Humans , https://github.com/saidwivedi/TokenHMR , https://github.com/pixelite1201/CameraHMR , https://github.com/isarandi/nlf
- https://github.com/DavidBoja/SMPL-Anthropometry
- https://github.com/facebookresearch/sam2

Solo vistas en resultados de búsqueda [S]:
- https://arxiv.org/abs/2511.03589 (Anny) y https://europe.naverlabs.com/blog/anny-a-free-to-use-3d-human-parametric-model-for-all-ages/
- https://arxiv.org/abs/2602.15989 (SAM 3D Body), https://arxiv.org/abs/2603.16858 (SOMA), https://nvlabs.github.io/SOMA-X/stable/model_card.html
- https://www.mpg.de/26082348/max-planck-spin-off-draws-epic-games-to-tuebingen , https://meshcapade.com/assets/body-models , https://dev.to/arkadiuss/a-3d-body-scan-for-nine-cents-without-smpl-4me1
- https://shapy.is.tue.mpg.de/ , https://arxiv.org/abs/2206.07036 (SHAPY, HBW)
- https://registry.opendata.aws/bodym/ , https://www.openlab.psu.edu/ansur2/
- https://docs.bodygram.com/platform/first-scan , https://3dlook.ai/pricing/ , https://www.prismlabs.tech/pricing-md , https://www.truetoform.fit/pricing , https://www.mirrorsize.com/getmeasured
