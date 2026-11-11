# Roles y plantillas de prompt

Cada plantilla es un punto de partida: rellena lo que va entre `<>`, quita lo que no aplique y añade el contexto que el agente necesita. Recuerda que el agente empieza sin saber nada de la conversación.

## Índice
1. Arquitecto/a (`fable`)
2. Investigador/a de ML y visión (`fable` diseño / `opus` prototipo)
3. Ingeniero/a 3D (`opus`)
4. Backend (`opus` / `sonnet`)
5. Frontend / móvil (`sonnet`)
6. Datos y catálogo (`sonnet`)
7. Explorador/a (`haiku`)
8. QA (`sonnet`)
9. Revisor/a crítico/a (`fable`)

Bloque de contexto común (pégalo al inicio de cualquier prompt y recórtalo según la tarea):

```
Proyecto: app "probador virtual 3D". El usuario se escanea con una foto de cuerpo
entero (avatar 3D con medidas reales y altura como escala), sube su ropa
(prendas 3D), combina outfits sobre su avatar y recibe recomendaciones de tiendas
según talla, fit preferido (holgura por zonas) y colorimetría (12 estaciones).
Stack: React Native/Expo + React Three Fiber; Supabase (Postgres, pgvector,
Storage); API propia; workers GPU en Python (serverless); todo el 3D en GLB.
Reglas: fotos de cuerpo/cara se borran tras procesarlas (RGPD); revisar licencias
comerciales de modelos; validar con todos los tonos de piel y tipos de cuerpo.
```

---

## 1. Arquitecto/a (`fable`)

Para decisiones que condicionan el resto: stack, contratos entre módulos, esquema de datos, go/no-go de la fase 0.

```
<contexto común>

Tu papel: arquitecto/a técnico/a. Tienes que decidir <decisión>.

Situación actual: <qué existe, qué se ha probado, restricciones de coste/tiempo/equipo>.
Opciones que conozco: <opciones, si las hay>; puedes proponer otras.

Entrega:
1. Recomendación en una frase.
2. Comparación de opciones (tabla: criterio · opción A · opción B ...), con
   coste, riesgo, tiempo y calidad esperada.
3. Riesgos de la opción elegida y cómo mitigarlos.
4. Contratos/interfaces concretos que deben respetar los demás módulos
   (tipos, endpoints, formatos de fichero).
5. Qué habría que medir para confirmar o revertir la decisión.

No escribas código de producción; sí pseudocódigo o esquemas si ayudan.
```

## 2. Investigador/a de ML y visión

**Diseño (`fable`):** cuando el problema es abierto (cómo distinguir oversize de talla mayor, cómo hacer la colorimetría robusta a la luz, qué enfoque de drapeado usar).

```
<contexto común>

Problema: <descripción precisa, p. ej. "clasificar si una prenda es oversize de
diseño o una talla regular más grande a partir de medidas y fotos">.
Datos disponibles: <qué hay o se puede conseguir>.
Restricciones: <latencia, coste GPU, licencias, precisión mínima>.

Entrega:
1. Enfoque recomendado y por qué, frente a 2–3 alternativas.
2. Pipeline paso a paso (entradas, modelos/librerías concretos con su licencia,
   salidas con su formato JSON).
3. Cómo evaluarlo: dataset, métricas y umbral de "suficientemente bueno".
4. Riesgos (sesgo, casos límite) y plan para cada uno.
5. Plan de prototipo de 1–2 semanas que pueda ejecutar otro agente.
```

**Prototipo (`opus`):** cuando el diseño ya está decidido.

```
<contexto común>

Implementa un prototipo de <componente> siguiendo este diseño: <diseño o enlace>.
Repositorio/carpeta: <ruta>. No toques: <ficheros fuera de alcance>.
Hecho cuando: <criterio comprobable, p. ej. "script que recibe una foto y devuelve
JSON con medidas; error medio < 3 cm en las 10 fotos de tests/fixtures">.
Devuelve: ficheros cambiados, cómo ejecutarlo, resultados medidos y limitaciones.
```

## 3. Ingeniero/a 3D (`opus`)

Visor con React Three Fiber, carga de GLB, skinning sobre el esqueleto que trae el GLB del avatar, capas de prendas, rendimiento en móvil (LOD, KTX2, Draco/Meshopt).

```
<contexto común>

Tarea: <p. ej. "visor que carga avatar.glb y una lista de prendas .glb, las ordena
por capa y permite rotar el avatar">.
Ficheros: <rutas>. Restricciones: 60 fps en un móvil de gama media; texturas KTX2.
Hecho cuando: <criterio>. Devuelve: cambios, cómo probarlo y medidas de rendimiento.
```

## 4. Backend (`opus` para diseño de API y lógica compleja; `sonnet` para endpoints bien especificados)

```
<contexto común>

Tarea: <endpoint/servicio/migración>.
Esquema relevante: <tablas: avatars, garments, garment_measurements, fit_results,
color_profiles, outfits, store_products, drape_cache, jobs...>.
Hecho cuando: <criterio + tests que deben pasar>.
Devuelve: cambios, migraciones, ejemplos de petición/respuesta.
```

## 5. Frontend / móvil (`sonnet`)

Pantallas de captura guiada, armario, creador de outfits, perfil de color, tienda.

```
<contexto común>

Pantalla/flujo: <descripción y estados: vacío, cargando, error, éxito>.
API disponible: <endpoints>. Diseño: <referencia>.
Hecho cuando: <criterio>. Devuelve: cambios y capturas o pasos para verlo.
```

## 6. Datos y catálogo (`sonnet`)

Ingesta de feeds de afiliación, normalización de categorías y tallas, base de tablas de medidas de prenda por marca.

```
<contexto común>

Tarea: <p. ej. "importar el feed <fuente> a store_products, normalizando tallas
a EU y categorías a nuestra taxonomía">.
Fuente y formato: <...>. Hecho cuando: <recuento esperado, validaciones>.
Devuelve: script, resumen de filas importadas/descartadas y por qué.
```

## 7. Explorador/a (`haiku`; o subagente `Explore` si existe)

Búsquedas y lectura masiva: dónde está algo en el código, qué dice una documentación, extraer datos de muchas páginas.

```
Busca <qué> en <dónde>. Amplitud: <media / muy exhaustiva>.
Devuelve solo la conclusión: rutas y líneas relevantes y un resumen de 5 líneas.
No copies ficheros enteros.
```

## 8. QA (`sonnet`)

```
<contexto común>

Verifica <entregable> contra este criterio: <criterio de hecho>.
Escribe o ejecuta los tests necesarios, incluyendo casos límite:
<p. ej. foto a contraluz, cuerpo fuera de rango de tallas, prenda sin etiqueta,
tono de piel muy claro/muy oscuro>.
Devuelve: qué pasa, qué falla (con la salida) y qué no se pudo probar.
```

## 9. Revisor/a crítico/a (`fable`)

Revisión final de cambios que tocan datos personales, seguridad o la integración entre módulos.

```
<contexto común>

Revisa <cambios/diff/diseño>. Busca, por orden de gravedad:
1. Fallos de privacidad (RGPD): fotos que se guardan, datos sin consentimiento,
   datos fuera de la UE, imposibilidad de borrar.
2. Fallos de seguridad.
3. Incoherencias entre módulos (contratos, formatos, unidades).
4. Licencias incompatibles con uso comercial.
5. Sesgos en modelos (tono de piel, tipo de cuerpo).
Devuelve una lista priorizada: problema · dónde · por qué importa · arreglo propuesto.
Si no encuentras nada grave, dilo claramente.
```
