# @probador/app — App Expo (web, Android, iOS)

App del probador virtual 3D con un único código para web, Android e iOS.

| Pieza | Versión |
|---|---|
| Expo SDK | 58 (`expo ~58.0.24`) |
| React Native | 0.88.1 |
| React | 19.3.0 |
| expo-router | ~58.0.31 (rutas en `src/app/`) |
| @react-three/fiber | 9.8.2 (web y `/native`) |
| three | 0.187.0 |
| expo-gl | ~58.0.4 |
| TypeScript | ~6.0.3 |

Requisitos: Node 20+ (probado con Node 22) y npm.

La app es un workspace de npm del monorepo: se instala **desde la raíz**, con un único `package-lock.json`, y depende de
`@probador/contracts` (`packages/contracts`, consumido como fuente TypeScript; Metro lo resuelve sin configuración).

```bash
cd probador-3d        # raíz del monorepo
npm install
cd apps/app
```

> Añade dependencias con `npx expo install <paquete>` desde `apps/app` para que Expo elija versiones compatibles con el SDK.
> No ejecutes `npm install` dentro de `apps/app`: crearía un lockfile suelto.

## Backend (Supabase)

La app usa el proyecto en la nube (`https://jxynipwqucetmeayyupi.supabase.co`, eu-west-3) con su **clave publicable**.
Los valores por defecto están en `src/lib/config.ts`; para apuntar a otro proyecto copia `.env.example` a `.env`
(ignorado por git) y cambia `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY`. Nunca pongas en la app la
`service_role` ni una clave `sb_secret_…`.

- **Sesión:** `localStorage` en web; en iOS/Android, el llavero / Keystore con `expo-secure-store` (troceada porque
  SecureStore admite como mucho 2048 bytes por valor). En nativo el refresco del token se pausa en segundo plano.
- **Acceso:** email y contraseña (`signUp` / `signInWithPassword`), sin enlaces mágicos ni URLs de retorno.
- **Edge Functions:** siempre con `?forceFunctionRegion=eu-west-3` (RGPD, M3) desde `src/lib/api.ts`. No se usa
  `functions.invoke(..., { region })` porque su cabecera `x-region` no pasa el CORS de las funciones
  (`docs/integration-issues.md`).
- **Escaneo:** consentimiento `body_scan` vigente → `create-job` (`type: "avatar"`) → subida única de la foto con
  `uploadToSignedUrl` (ruta `raw-uploads/<uid>/<id>.jpg`) → `create-job/uploaded`. El estado llega por Realtime
  (`jobs` está en la publicación `supabase_realtime`) con sondeo cada 4 s de respaldo. Con el job `succeeded`, la app
  firma `avatars.glb_path` (1 h) y carga el GLB en el visor.
- **Privacidad de la foto:** se elige sin EXIF, se reescala a 2048 px y se recodifica en JPEG (sin metadatos); la copia
  temporal se borra al subirla o al quitarla; nunca se registra en logs. El servidor la borra al terminar el job.

### Qué hay que configurar en el panel de Supabase (Auth)

La app no necesita SMTP propio ni URLs de redirección si se desactiva la confirmación por email mientras se prueba:

1. **Authentication → Sign In / Providers**: «Allow new users to sign up» activado y proveedor **Email** activado
   (vienen así por defecto).
2. En el proveedor **Email**, desactiva **«Confirm email»** y guarda. Así el alta inicia sesión al momento.
   (Con la confirmación activada, el correo por defecto de Supabase solo llega a los emails del equipo del proyecto y
   con un límite de pocos correos por hora; además, el enlace redirige a la «Site URL».)
3. Opcional: **Authentication → Sign In / Providers → Email → «Minimum password length»** a 8 (la app ya exige 8).
4. **Authentication → URL Configuration**: nada obligatorio con lo anterior. Si mantienes «Confirm email», pon como
   *Site URL* la de la web (en local `http://localhost:8081`); el email queda confirmado aunque la redirección falle.
5. Antes de abrir la app a terceros: **Authentication → Emails → SMTP Settings** (SMTP propio), plantillas en
   español y volver a activar «Confirm email».

Realtime, RLS y Storage no necesitan cambios.

### Probar (Windows PowerShell)

```powershell
cd probador-3d          # raíz del monorepo
npm install
npm run check           # tests de contratos y de la app + typecheck
cd apps\app
npm run web             # http://localhost:8081 en el navegador
npx expo start          # escanea el QR con Expo Go (SDK 58); si el móvil no está en la misma red: npx expo start --tunnel
```

Flujo: crear cuenta → Escanear → «Leer y aceptar el consentimiento» (mayoría de edad + `body_scan`) → foto, altura y
peso → «Crear mi avatar». Mientras no haya modelo de IA, el job termina en «Todavía no disponible» y la app indica que la
foto ya se ha borrado. Perfil: exportar mis datos (descarga un JSON en web; menú de compartir en el móvil) y borrar la
cuenta (hay que escribir BORRAR).

Todas las dependencias nativas nuevas (`expo-secure-store`, `expo-image-picker`, `expo-image-manipulator`,
`expo-sharing`) vienen en Expo Go.

## Web

```bash
npm run web                         # servidor de desarrollo (http://localhost:8081)
npx expo export --platform web      # build estática en dist/ (SPA, output "single")
npx serve -s dist                   # servirla en local
```

## Android e iOS con Expo Go (desarrollo rápido)

1. Instala **Expo Go** en el móvil (debe ser la versión compatible con el SDK 58).
2. `npm start` y escanea el QR (Android: desde Expo Go; iOS: con la cámara).
3. Atajos en la terminal: `a` abre el emulador Android, `i` el simulador iOS (solo macOS).

Todas las dependencias nativas actuales (`expo-gl`, `expo-asset`, `expo-file-system`, `react-native-screens`, `react-native-safe-area-context`) vienen incluidas en Expo Go, así que el visor 3D funciona sin build propia.

## Builds nativas con EAS

Identificadores de ejemplo: `com.probador.app` (Android `package` e iOS `bundleIdentifier`, en `app.json`). Cámbialos antes de publicar.

```bash
npx eas-cli@latest login
npx eas-cli@latest init                                   # vincula el proyecto (añade projectId a app.json)
npx eas-cli@latest build --profile development --platform android   # dev client (cuando haya módulos nativos fuera de Expo Go)
npx eas-cli@latest build --profile preview --platform android       # APK interno para probar
npx eas-cli@latest build --profile production --platform ios        # requiere cuenta de Apple Developer
```

Los perfiles están en `eas.json`. Las carpetas `android/` e `ios/` no se versionan: se generan con `npx expo prebuild` (Continuous Native Generation); la configuración nativa va en `app.json` o en config plugins.

Build local sin EAS (requiere Android Studio / Xcode): `npx expo run:android`, `npx expo run:ios`.

## Comprobaciones

```bash
npm test                             # tests unitarios (node --test, sin dependencias)
npm run typecheck                    # tsc --noEmit (app y tests)
npx expo export --platform web
npx expo export --platform android   # comprueba que el bundle nativo compila (no necesita emulador)
npx expo export --platform ios
```

## Estructura

```
src/
  app/                        rutas de expo-router
    _layout.tsx               raíz: sesión (AuthProvider), tema y Stack (pestañas, login, consentimientos)
    login.tsx                 acceso con email y contraseña (alta e inicio de sesión)
    consentimientos.tsx       textos vigentes de consent_texts; aceptar / retirar; mayoría de edad
    (tabs)/_layout.tsx        pestañas (redirige a /login sin sesión)
    (tabs)/index.tsx          Escanear: visor (GLB del avatar o maniquí), medidas, estado del job, foto + altura + peso
    (tabs)/armario.tsx        prendas propias; añadir prenda (job garment)
    (tabs)/perfil.tsx         cuenta, cerrar sesión, consentimientos, exportar datos, borrar cuenta
    (tabs)/outfits.tsx, tienda.tsx
  auth/AuthProvider.tsx       sesión de Supabase para toda la app
  components/
    avatar/                   visor 3D (web / nativo); useGlbModel.ts descarga y parsea el GLB firmado
    JobStatusCard.tsx         cola / procesando / listo / fallido y si la foto ya se borró
    PhotoPicker.tsx           hacer o elegir foto, preparada sin metadatos
    ui.tsx                    Card, Button, Banner, Field, Loading…
    Screen.tsx, EmptyState.tsx
  lib/
    config.ts                 URL y clave publicable (EXPO_PUBLIC_* o valores por defecto)
    supabase.ts               cliente único; sessionStorage(.native).ts guarda la sesión
    api.ts                    llamadas a Edge Functions con región eu-west-3 (apiErrors.ts: errores y textos)
    jobs.ts                   create-job → subida firmada → create-job/uploaded; useJob (Realtime + sondeo)
    jobStatus.ts              fila de jobs → textos de la interfaz (not_implemented, borrado de la foto…)
    consents.ts, useConsents.ts, consentTexts.ts
    photo.ts, bytes(.native).ts, uploadPaths.ts   foto: selección, ≤ 2048 px, JPEG sin EXIF, rutas raw-uploads
    avatars.ts, garments.ts, account.ts, saveExport(.native).ts
    height.ts                 validación de altura (100–250 cm) y peso (20–350 kg)
  theme/                      paletas clara/oscura y tema de navegación
tests/                        tests unitarios de la lógica sin React Native (node --test)
```

## Tema

Sigue el modo claro/oscuro del sistema (`userInterfaceStyle: "automatic"`). Colores en `src/theme/colors.ts`.

## Limitaciones conocidas del 3D en nativo

- `expo-gl` implementa WebGL 1/2 parcialmente: no hay `OffscreenCanvas` ni algunas extensiones; sombras, postprocesado y texturas grandes deben probarse en dispositivo real.
- El antialiasing y el rendimiento dependen del dispositivo y de expo-gl (los bordes pueden verse más dentados que en web); en el simulador de iOS y el emulador Android el render es lento porque usan GPU por software.
- Cargar glTF/GLB en nativo (`useLoader`/`GLTFLoader`) pasa por `expo-asset`/`expo-file-system`; las texturas embebidas en GLB pueden necesitar ajustes. Validarlo cuando llegue el GLB real del avatar (la app solo consume el GLB y las medidas: no depende del modelo corporal).
- `@react-three/drei` no es totalmente compatible con nativo (p. ej. `OrbitControls`, `Html`); por eso el giro se hace con `PanResponder` propio.
- El giro re-renderiza la escena en cada movimiento (suficiente para un maniquí sencillo); con mallas pesadas convendrá mover la rotación a `useFrame`/refs.
- Hot reload en nativo puede dejar el contexto GL en mal estado; si el visor queda en negro, recarga la app.

## Publicar en AWS (Amplify Hosting)

La web se publica con AWS Amplify Hosting usando `amplify.yml` de la raíz. Cada push a `main` la vuelve a publicar.

1. Consola de AWS → región **eu-west-3 (París)** → Amplify → *Create new app* → GitHub → repositorio `probador-3d`, rama `main`.
2. Marca **«My app is a monorepo»** y pon `apps/app` como carpeta.
3. Amplify detecta `amplify.yml`. Crea el rol de servicio que propone y despliega.
4. *Hosting → Rewrites and redirects → Manage redirects*, añade esta regla (la app es de una sola página):
   - Source: `</^[^.]+$|\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|wasm|glb)$)([^.]+$)/>`
   - Target: `/index.html`
   - Type: `200 (Rewrite)`
5. En Supabase → Authentication → URL Configuration, pon la URL de Amplify (`https://main.<id>.amplifyapp.com`) como *Site URL* y en *Redirect URLs*.
