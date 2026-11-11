# Drapeado de prendas sobre el avatar

Estado: diseño de fase 0 (2026-11-11). Verificación: **[V]** fuente primaria abierta, **[S]** solo resumen de buscador, **[M]** memoria, sin verificar. Todos los tiempos sin etiqueta [V] son estimaciones a medir en el prototipo P3.

## 1. Recomendación

Hacer el drapeado con **simulación física estática en servidor GPU sobre NVIDIA Warp / Newton (Apache 2.0)**, cacheada por avatar + prenda + talla + capas, y dejar el drapeado neuronal como línea de investigación para la fase 3.

Motivos:

- Licencia limpia: Warp es Apache 2.0 [V] y Newton (proyecto de la Linux Foundation construido sobre Warp) también [V]. Newton trae solvers `xpbd`, `vbd`, `style3d` y `semi_implicit` [V], y un ejemplo oficial que viste una sudadera sobre un maniquí con `SolverStyle3D` a partir de paneles [V].
- La física generaliza a cualquier patrón y cualquier cuerpo sin entrenar; el drapeado neuronal disponible (HOOD, ContourCraft) exige SMPL [V], cuya licencia queremos evitar, y sus pesos no tienen licencia declarada [V].
- El caso de uso es una pose fija (A o reposo) por outfit: solo hace falta el estado de equilibrio, no animación en tiempo real. Unos segundos por prenda en servidor más caché es suficiente.
- La simulación da además el mapa de tensión y holgura por zona, que alimenta el módulo de fit en la fase 3.

No usar el fork `NvidiaWarp-GarmentCode`: NVIDIA Source Code License, solo no comercial, basado en Warp 1.0.0-beta.6 [V]. Hay que reimplementar sobre Warp/Newton oficiales lo que ese fork añade: colisión punto-triángulo y arista-arista, expulsión de tela que queda dentro del cuerpo y restricciones de sujeción (por ejemplo, cintura de una falda) [V].

## 2. Opciones comparadas

Elegir Newton/Warp como motor principal y `ppf-contact-solver` como referencia de calidad fuera de línea.

| Opción | Tipo | Licencia | Calidad | Tiempo por prenda | Encaje |
|---|---|---|---|---|---|
| **Newton `SolverStyle3D` / `SolverVBD`** | Física en GPU | Apache 2.0 [V] | Buena; Style3D con rigidez anisótropa por tejido [V]. Autocolisión no configurada en el ejemplo [V]: comprobar | Objetivo 5–20 s en L4 (10–30 k triángulos, 200–400 pasos) | **Recomendado.** API joven: fijar versión (usa Warp 1.18 [V]) |
| **Warp XPBD** propio | Física en GPU | Apache 2.0 [V] | Suficiente; sin autocolisión de serie, hubo que añadirla en GarmentCodeData [S] | Similar | Alternativa si Newton no es estable |
| `NvidiaWarp-GarmentCode` | Física (XPBD) | **No comercial** [V] | Probada en 115 k prendas [M] | — | Solo como referencia de lectura |
| `ppf-contact-solver` (ZOZO) | Física, barrera cúbica sin intersecciones | Solver Apache 2.0; complemento de Blender GPL-3.0 [V] | Muy alta; cada paso que termina queda libre de intersecciones [V] | Ejemplo "drape": 100 fotogramas en unos 2,7 min en L4 [V] | Referencia de calidad y casos multicapa difíciles. Proyecto temprano, una sola persona lo mantiene [V] |
| HOOD (CVPR 2023) | Red de grafos, cualquier prenda | Código MIT; pesos sin licencia declarada [V] | Buena en dinámica; requiere SMPL [V] | Décimas de segundo por fotograma [M] | No ahora: SMPL y pesos |
| ContourCraft (SIGGRAPH 2024) | HOOD + resolución de intersecciones multicapa | MIT; pesos sin declarar; SMPL solamente, SMPL-X pendiente [V] | La mejor opción neuronal para capas | — | Investigación fase 3; es el simulador que usa ChatGarment |
| SNUG, NeuralClothSim | Red por prenda, autosupervisada | Sin verificar [M] | Una red por prenda: no escala a un armario arbitrario [M] | Milisegundos | Descartado |
| CLO3D / Style3D (escritorio) | Comercial | De pago | Referencia de la industria | — | Solo para prendas de nivel 3 de marca |

## 3. Pipeline de simulación

Implementar un drapeado estático en seis pasos, determinista y reproducible.

1. **Entradas**: malla del avatar en pose A (GLB), patrón de la prenda (paneles, costuras, colocación 3D inicial de GarmentCode), talla, tejido y capa.
2. **Mallado**: triangular cada panel con arista objetivo de 1,0–1,5 cm (5–30 k triángulos por prenda); conservar la correspondencia panel → UV.
3. **Colocación inicial**: paneles situados alrededor del cuerpo según el patrón; el cuerpo se representa como malla con BVH o campo de distancias, con margen de 2–4 mm.
4. **Cosido**: muelles de longitud de reposo cero entre vértices de costura, con rigidez creciente; al cerrar, fusionar vértices. Gravedad reducida al principio.
5. **Relajación**: gravedad completa, fricción cuerpo–tela, autocolisión; parar cuando la velocidad máxima baje de un umbral o a los N pasos. Sujeciones para cinturas y tirantes.
6. **Salida**: malla drapeada con UV y normales en GLB (compresión meshopt o Draco, objetivo < 1,5 MB por prenda), más por vértice la distancia al cuerpo y la deformación, y un indicador de calidad (intersecciones restantes, energía residual, costuras abiertas).

Parámetros de tejido: 4–6 preajustes (punto fino, punto grueso, plana ligera, plana rígida, vaquero, seda) con rigidez a tracción y flexión y densidad; se eligen por el atributo "tejido" de la prenda.

Otras poses: la fase 0 solo cubre pose A. Para poses en fase 3, interpolar el cuerpo desde A hasta la pose final durante la simulación.

## 4. Caché

Cachear el resultado por clave de contenido y reutilizarlo entre usuarios de cuerpo parecido.

- **Clave**: `hash(modelo corporal + forma cuantizada, pose, id y versión de prenda, talla, tejido, firma de capas inferiores, versión del simulador)`. Tabla `drape_cache`; el GLB va a S3/R2.
- **Cuantización del cuerpo**: redondear las medidas principales (pecho, cintura, cadera, altura, hombros) a pasos de 1–2 cm para que usuarios parecidos compartan entrada. Si no hay acierto exacto, servir de inmediato el vecino más cercano reajustado y lanzar la simulación exacta en segundo plano.
- **Reajuste barato**: transferir la prenda drapeada de un cuerpo a otro cercano manteniendo el desplazamiento respecto a la superficie del cuerpo (cada vértice de la prenda se ancla a su punto más próximo del cuerpo). Válido para diferencias pequeñas; medir en P3 hasta qué diferencia aguanta.
- **Catálogo de tiendas**: precomputar cada producto y talla sobre una rejilla de 30–50 cuerpos representativos, y simular bajo demanda para el usuario que lo abre.
- **Invalidación**: por versión de simulador o de patrón; nunca por tiempo.

Latencia percibida: acierto de caché < 300 ms; fallo 5–20 s en cola, mostrando mientras tanto la prenda reajustada.

## 5. Capas

Simular de dentro hacia fuera, con las capas interiores congeladas como colisionadores, y limitar el MVP a combinaciones sencillas.

- Cada prenda declara una capa (0 ropa interior, 1 camiseta o pantalón, 2 jersey o camisa abierta, 3 abrigo) y, si procede, una regla de metido o por fuera.
- **MVP**: cada prenda se drapea sola sobre el cuerpo y se cachea. Al combinar, las prendas de capas distintas en la misma zona se resuelven en el visor con un pequeño desplazamiento a lo largo de la normal y orden de pintado por capa; superior e inferior se solapan con la regla de metido o por fuera (recortar por máscara la parte oculta). Es barato y mantiene la caché por prenda individual.
- **Fase 3**: simulación real multicapa: cuerpo + capas interiores ya drapeadas, infladas 2–3 mm, como colisionador de la capa exterior. La clave de caché incluye la firma de las capas inferiores, así que solo se cachea la combinación concreta. Referencias: ContourCraft para la vía neuronal, `ppf-contact-solver` para la física sin intersecciones.

## 6. Coste

Presupuestar una GPU L4 o equivalente compartida con el worker de prendas; con caché, el coste medio por prenda vista es marginal.

Estimación: 10 s de L4 por simulación equivalen a unos 0,003 € (a 0,7–1,0 €/h); un armario de 50 prendas cuesta unos 0,15 € de cómputo una sola vez por usuario y cambio de cuerpo.

## 7. Riesgos abiertos

- Autocolisión y prendas cerradas (mangas, perneras) estables en Newton: sin confirmar; es el objetivo técnico de P3.
- Newton es reciente y su API cambia; fijar versión y tener Warp XPBD propio como salida.
- El modelo corporal no afecta a la física, pero sí a la vía neuronal (solo SMPL).
- Dependencia del mallado y la colocación de `pygarment` respecto al fork no comercial (ver `garment.md`).

## Fuentes

Abiertas [V]:
- https://github.com/NVIDIA/warp
- https://github.com/newton-physics/newton , `newton/_src/solvers` y `newton/examples/cloth/example_cloth_style3d.py`
- https://github.com/maria-korosteleva/NvidiaWarp-GarmentCode
- https://github.com/st-tech/ppf-contact-solver
- https://github.com/Dolorousrtur/HOOD , https://github.com/Dolorousrtur/ContourCraft
- https://github.com/biansy000/ChatGarment

Solo vistas en resultados de búsqueda [S]:
- https://arxiv.org/abs/2405.17609 (GarmentCodeData: simulación XPBD sobre Warp con autocolisión añadida)
- https://arxiv.org/abs/2212.07242 (HOOD)

No accesibles desde esta sesión: newton-physics.github.io, arxiv.org.
