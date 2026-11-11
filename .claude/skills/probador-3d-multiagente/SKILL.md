---
name: probador-3d-multiagente
description: Orquesta un equipo de subagentes (con el modelo adecuado para cada tarea, incluido Claude Fable para lo más difícil) para desarrollar el proyecto "probador virtual 3D" (avatar 3D desde una foto, armario con prendas 3D, drapeado, colorimetría personal, fit y holgura de prendas, recomendaciones de tiendas). Úsala siempre que el usuario quiera avanzar, implementar, investigar, revisar o planificar cualquier parte de este proyecto con varios agentes en paralelo, repartir trabajo entre agentes, "montar el equipo", ejecutar una fase del plan (fase 0, MVP, tiendas, realismo), o decidir qué modelo usar para cada tarea, aunque no diga "multiagente" ni "Fable" explícitamente.
---

# Probador 3D: desarrollo con varios agentes

Esta skill convierte una petición sobre el proyecto en un trabajo repartido entre subagentes especializados, cada uno con el modelo que mejor encaja con su tarea. Tú actúas como **orquestador**: entiendes la petición, la divides, lanzas a los agentes, integras sus resultados y respondes al usuario.

## Contexto del proyecto

App de moda donde el usuario se escanea con una foto de cuerpo entero (avatar 3D SMPL-X con medidas reales), sube su ropa (convertida en prendas 3D), combina outfits sobre su avatar y recibe recomendaciones de tiendas según talla, fit preferido y colorimetría.

- Plan completo (documento vivo): https://claude.ai/artifact/NTjptmfYWP4XQUwfVG3m5C. Léelo con las herramientas de docs (no con web fetch) cuando necesites detalles de una sección; es la fuente de verdad si difiere de este resumen.
- Resumen de módulos, fases y decisiones técnicas: `references/proyecto.md`. Léelo antes de repartir trabajo si no tienes el plan en contexto.

## Qué modelo para qué tarea

Cada modelo tiene su sitio. El criterio es: **cuánto razonamiento difícil exige la tarea y cuánto cuesta un error**, frente a precio y velocidad.

| Modelo (`model` en la herramienta Agent) | Úsalo para | Evítalo para |
|---|---|---|
| `fable` (Claude Fable 5.2, el más capaz; ~2x el precio de Opus, turnos largos) | Decisiones de arquitectura que condicionan meses de trabajo; diseño de algoritmos difíciles (ajuste SMPL-X, foto → patrón de costura, simulación de tela, clasificador oversize vs talla mayor, colorimetría robusta a la luz y sin sesgo de tono de piel); evaluación técnica de la fase 0 (go/no-go); revisión final de cambios críticos (privacidad RGPD, seguridad, integración entre módulos); depurar fallos que otros agentes no resolvieron | Tareas mecánicas, CRUD, UI, búsquedas, resúmenes, ingesta de datos: paga mucho más sin mejorar el resultado |
| `opus` (Claude Opus 5.5, modelo por defecto) | Implementación de módulos con lógica no trivial: pipelines de visión, escena 3D con React Three Fiber, API, ranking de recomendaciones; revisión de código general; investigación técnica con síntesis | Exploración masiva de ficheros o lectura de mucha documentación |
| `sonnet` (Claude Sonnet 5.5) | Código del día a día bien especificado: componentes de UI, endpoints, migraciones, tests, scripts de ingesta de catálogos, normalización de tallas | Diseño de algoritmos nuevos o decisiones de arquitectura |
| `haiku` (Claude Haiku 5.5, muy barato) | Lectura y búsqueda: localizar código, extraer datos de muchas páginas o ficheros, etiquetar en lote, resumir documentación | Cualquier cosa que requiera criterio o escribir código importante |

Por qué no "Fable para todo": cuesta el doble que Opus, sus turnos en tareas difíciles pueden durar muchos minutos y en trabajo rutinario no rinde más. Resérvalo para los puntos donde un error de diseño sale caro. Por qué no "Haiku para todo": en el código y las decisiones, ahorrar en el modelo suele costar más en retrabajo.

Si el usuario pide otro reparto (por ejemplo "todo con Fable" o "mantenlo barato"), su preferencia manda: ajústalo y dilo.

## Roles del equipo

Los roles y la plantilla de prompt de cada uno están en `references/roles.md`. Resumen:

| Rol | Modelo por defecto | Cuándo entra |
|---|---|---|
| Arquitecto/a | `fable` | Diseño transversal, decisiones de stack, fase 0, go/no-go |
| Investigador/a de ML y visión | `fable` (diseño) / `opus` (prototipo) | Avatar, prendas 3D, drapeado, colorimetría, fit |
| Ingeniero/a 3D | `opus` | Visor, escena, skinning, rendimiento móvil |
| Backend | `opus` o `sonnet` | API, base de datos, colas GPU, almacenamiento |
| Frontend / móvil | `sonnet` | Pantallas, flujo de captura, armario, outfits |
| Datos y catálogo | `sonnet` | Feeds de afiliación, tablas de medidas por marca, normalización |
| Explorador/a | `haiku` (tipo `Explore` si existe) | Buscar en el código, leer documentación, extraer datos |
| QA | `sonnet` | Tests, casos límite, verificación de lo entregado |
| Revisor/a crítico/a | `fable` | Revisión final de privacidad, seguridad e integración |

## Flujo de trabajo

### 1. Entender y acotar

Lee la petición y decide qué parte del plan toca (módulo y fase). Si falta algo que cambie el resultado (por ejemplo, el repositorio sobre el que trabajar o si quiere código o solo un diseño), pregúntalo una vez. Si no, asume lo razonable y dilo.

### 2. Dividir en tareas

Parte el trabajo en tareas **independientes** con un entregable claro cada una. Una buena tarea:
- se puede hacer sin esperar a otra (o declara de cuál depende);
- toca un conjunto de ficheros distinto al de las demás, para que no choquen;
- tiene un criterio de "hecho" comprobable.

Si dos tareas dependen entre sí, ordénalas en oleadas: primero el diseño (a menudo con `fable`), luego la implementación en paralelo, luego QA y revisión.

Comparte el reparto con el usuario en una tabla breve (tarea · rol · modelo · por qué) antes de lanzar trabajo grande o caro. Para algo pequeño, lanza directamente.

### 3. Lanzar a los agentes

- Usa la herramienta `Agent` con `model` según la tabla. Los agentes nuevos empiezan sin contexto: el prompt debe ser autocontenido (contexto del proyecto relevante, objetivo, ficheros, restricciones, criterio de hecho y formato de respuesta). Usa las plantillas de `references/roles.md`.
- Lanza en un mismo mensaje las tareas independientes, para que corran en paralelo.
- Si varios agentes van a editar código del mismo repositorio a la vez, usa `isolation: "worktree"` para que cada uno trabaje en su copia y no se pisen.
- A `fable` dale la especificación completa desde el principio (objetivo, restricciones, qué decidir y cómo justificarlo): rinde mejor con el problema entero que con instrucciones paso a paso.
- Un `fork` hereda tu contexto pero ignora `model`: no lo uses cuando quieras un modelo concreto.

### 4. Integrar

Cuando lleguen los resultados:
- comprueba que cada entregable cumple su criterio de hecho; si no, devuélvelo al mismo agente con `SendMessage` en vez de empezar uno nuevo;
- resuelve conflictos entre agentes (por ejemplo, dos esquemas de datos distintos) con criterio propio, o con `fable` si la decisión es de arquitectura;
- en cambios que afecten a datos personales (fotos de cuerpo o cara), seguridad o la integración entre módulos, pasa una revisión final con el rol revisor/a crítico/a (`fable`).

### 5. Informar al usuario

Responde con: qué se hizo, qué agente y modelo hizo cada parte, qué queda abierto y el siguiente paso recomendado. Si el trabajo cambia el plan (una decisión técnica nueva, una fase que se retrasa), propón actualizar el documento del plan.

## Reglas del proyecto que todos los agentes deben respetar

Inclúyelas en el prompt de cualquier agente que toque datos personales, modelos de ML o el pipeline 3D:

- **Privacidad (RGPD):** las fotos de cuerpo y cara se borran tras procesarlas; solo se guardan valores calculados. Servidores en la UE, consentimiento explícito, borrado total.
- **Licencias:** comprueba la licencia comercial de cada modelo o dataset (SMPL-X necesita licencia; muchos modelos de investigación son solo no comerciales).
- **Cuerpo paramétrico:** el avatar es SMPL-X (o alternativa compatible); las prendas y la simulación se apoyan en ese esqueleto.
- **Formato 3D:** glTF/GLB en todo el sistema.
- **Sesgo:** la colorimetría y la estimación corporal se validan con todos los tonos de piel y tipos de cuerpo.
