import { useMemo, useRef, useState } from 'react';
import { PanResponder, type GestureResponderHandlers } from 'react-native';

/** Radianes de giro por píxel arrastrado. */
const RADIANS_PER_PX = 0.01;

/**
 * Giro horizontal por arrastre, común a web (ratón/táctil vía react-native-web)
 * y nativo. Se usa la fase de *captura* para que el gesto lo reciba este
 * contenedor aunque el <Canvas> nativo de R3F tenga su propio PanResponder.
 * Los gestos verticales se dejan pasar al ScrollView.
 */
export function useDragRotation(initial = 0): {
  rotationY: number;
  panHandlers: GestureResponderHandlers;
  reset: () => void;
} {
  const [rotationY, setRotationY] = useState(initial);
  const start = useRef(initial);
  const current = useRef(initial);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Solo reclamamos gestos claramente horizontales: así el scroll vertical
        // de la pantalla sigue funcionando cuando el dedo empieza sobre el visor.
        onMoveShouldSetPanResponderCapture: (_evt, g) =>
          Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = current.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          current.current = start.current + gesture.dx * RADIANS_PER_PX;
          setRotationY(current.current);
        },
      }),
    [],
  );

  return {
    rotationY,
    panHandlers: responder.panHandlers,
    reset: () => {
      current.current = initial;
      setRotationY(initial);
    },
  };
}
