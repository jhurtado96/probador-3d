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

```bash
cd apps/app
npm install
```

> Añade dependencias con `npx expo install <paquete>` para que Expo elija versiones compatibles con el SDK.

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
npm run typecheck                    # tsc --noEmit
npx expo export --platform web
npx expo export --platform android   # comprueba que el bundle nativo compila (no necesita emulador)
npx expo export --platform ios
```

## Estructura

```
src/
  app/                        rutas de expo-router
    _layout.tsx               raíz: tema claro/oscuro + Stack
    (tabs)/_layout.tsx        pestañas: Escanear, Armario, Outfits, Tienda, Perfil
    (tabs)/index.tsx          Escanear: guía de captura + altura validada
    (tabs)/armario.tsx, outfits.tsx, tienda.tsx, perfil.tsx
  components/
    avatar/
      AvatarViewer.tsx        web: Canvas de @react-three/fiber (WebGL)
      AvatarViewer.native.tsx iOS/Android: Canvas de @react-three/fiber/native + expo-gl
      AvatarViewerShell.tsx   marco común (tamaño, gesto de giro, botón Restablecer)
      MannequinScene.tsx      escena común: luces, peana y maniquí de primitivas en pose A
      useDragRotation.ts      giro por arrastre horizontal (PanResponder, web y nativo)
    Screen.tsx, EmptyState.tsx
  lib/height.ts               validación de la altura (100–250 cm, admite coma decimal)
  theme/                      paletas clara/oscura y tema de navegación
```

Metro elige `AvatarViewer.native.tsx` en iOS/Android y `AvatarViewer.tsx` en web; TypeScript usa los tipos de `AvatarViewer.tsx`, así que ambas versiones deben mantener la misma firma.

## Tema

Sigue el modo claro/oscuro del sistema (`userInterfaceStyle: "automatic"`). Colores en `src/theme/colors.ts`.

## Limitaciones conocidas del 3D en nativo

- `expo-gl` implementa WebGL 1/2 parcialmente: no hay `OffscreenCanvas` ni algunas extensiones; sombras, postprocesado y texturas grandes deben probarse en dispositivo real.
- El antialiasing y el rendimiento dependen del dispositivo y de expo-gl (los bordes pueden verse más dentados que en web); en el simulador de iOS y el emulador Android el render es lento porque usan GPU por software.
- Cargar glTF/GLB en nativo (`useLoader`/`GLTFLoader`) pasa por `expo-asset`/`expo-file-system`; las texturas embebidas en GLB pueden necesitar ajustes. Validarlo cuando llegue el avatar SMPL-X real.
- `@react-three/drei` no es totalmente compatible con nativo (p. ej. `OrbitControls`, `Html`); por eso el giro se hace con `PanResponder` propio.
- El giro re-renderiza la escena en cada movimiento (suficiente para un maniquí sencillo); con mallas pesadas convendrá mover la rotación a `useFrame`/refs.
- Hot reload en nativo puede dejar el contexto GL en mal estado; si el visor queda en negro, recarga la app.
