# Encargados del tratamiento (art. 28 RGPD)

Registro de los proveedores que tratan datos personales por cuenta nuestra. Sirve para el registro de actividades (art. 30), la EIPD y la política de privacidad. **Pendiente de revisión por un abogado.**

| Proveedor | Qué hace | Datos que le llegan | Dónde | Contrato | Transferencias fuera del EEE |
|---|---|---|---|---|---|
| Supabase | Base de datos, Storage, Auth, Edge Functions | Todos los de la app (cuenta, fotos temporales, medidas, perfil de color, armario) | eu-west-3 (París). Edge Functions: París por defecto, pero quien llama puede elegir región (ver `supabase/README.md`, M3) | DPA de Supabase (pendiente de descargar y archivar) | Pendiente de revisar en su DPA |
| Modal Labs, Inc. (EE. UU.) | Workers GPU: avatar, prenda, drapeado, color | Dentro del contenedor (región `eu`): foto de cuerpo/cara (borrada tras procesarla), medidas, `user_id`. En su plano de control y cola: solo avisos con ids, sin `user_id` (ver `services/workers/README.md`) | Cómputo: región `eu` (EEE). Entrada del endpoint compartido: EE. UU. (la URL desplegada es `…dispatch.us-east.modal.run`). Cola de `.spawn()`: almacenamiento central en EE. UU. | DPA de Modal, vigente desde el 31-10-2025, incorporado por referencia en los términos (se acepta al aceptar los términos; no hay firma aparte) | Cláusulas contractuales tipo (Decisión 2021/914, módulos 2 y 3) incorporadas en el DPA; ley y foro de Suecia |

## Proveedores que no reciben datos personales

El pipeline del avatar corre entero dentro del contenedor de Modal (región `eu`): la foto no sale de ahí hacia ninguna API de terceros (SAM 3D Body, MHR y el detector se ejecutan en nuestra GPU con pesos propios en un volumen de Modal).

| Proveedor | Para qué | Qué recibe |
|---|---|---|
| Hugging Face | Descarga única de los pesos de SAM 3D Body (repositorio con acceso restringido) a un volumen de Modal | Solo la petición de descarga con el token de lectura de nuestra cuenta; ningún dato de usuarios. Los workers trabajan sin conexión a Hugging Face (`HF_HUB_OFFLINE=1`) |
| GitHub y download.pytorch.org | Código y assets de MHR y SAM 3D Body, pesos del detector | Nada de usuarios |
| Wikimedia Commons | Solo la prueba automática del avatar (foto pública CC0 o de dominio público) | Nada de usuarios |

Licencias de los modelos verificadas: `docs/research/avatar.md` §8 bis.

## Modal: puntos del DPA que nos afectan

- **Aceptación.** El DPA forma parte del contrato; aceptar los términos de servicio equivale a firmar también las cláusulas contractuales tipo (apéndice 1, «Signatories»). Archivar una copia en PDF con la fecha.
- **Transferencias (§10).** Modal no puede tratar datos fuera del EEE o Reino Unido sin consentimiento escrito, salvo con un mecanismo válido, como las cláusulas contractuales tipo incluidas. Cubre la parte que pasa por EE. UU. (plano de control, cola, entrada del endpoint), aunque por diseño ahí solo viajan ids.
- **Datos sensibles: «N/A» (anexo 1).** El DPA no contempla categorías especiales. Nuestro diseño no usa las fotos para identificar a nadie, así que en principio no son datos biométricos del art. 9, pero **lo debe confirmar el abogado**. Si se consideraran categoría especial, habría que pedir a Modal un anexo o cambiar de proveedor.
- **Subencargados (§5, anexo 3).** Modal publica su lista y avisa de cambios por email a quien se suscribe. **Acción:** suscribirse con el email de la empresa. Si no aceptamos un subencargado nuevo, la única salida es dar de baja el servicio.
- **Brechas (§7).** Notificación «sin dilación indebida», sin plazo en horas. Nosotros tenemos 72 h para avisar a la AEPD (art. 33), así que hay que vigilar los avisos de Modal.
- **Borrado (§9).** Al terminar el contrato. Nosotros ya no dejamos datos en Modal: la función devuelve `None` y las fotos se borran en Supabase.
- **Auditoría (§10 del DPA, «Audit rights»).** Informe SOC 2 Type II disponible si se pide por escrito. Conviene pedirlo antes del lanzamiento.

## Pendiente

- Descargar y archivar el DPA de Supabase y revisar sus transferencias.
- Suscribirse a los avisos de subencargados de Modal y de Supabase.
- Pedir a Modal el informe SOC 2 Type II.
- Revisión legal: categoría de las fotos, medidas y perfil de color (art. 9) y si hace falta EIPD.
