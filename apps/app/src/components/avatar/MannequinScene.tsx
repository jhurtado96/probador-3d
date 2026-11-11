/**
 * Escena 3D compartida entre web y nativo.
 *
 * Solo usa elementos intrínsecos de React Three Fiber (<mesh>, <group>, luces...)
 * y no importa nada de '@react-three/fiber', así funciona igual dentro del
 * <Canvas> web y del <Canvas> nativo (expo-gl).
 *
 * El maniquí está hecho con primitivas y en pose A, que es la misma pose que se
 * pide en la guía de captura. Mide ~1,75 unidades (1 unidad = 1 m) y tiene los
 * pies en y = 0. Cuando exista el avatar SMPL-X real (glTF/GLB) sustituirá a
 * <Mannequin />.
 */

type Vec3 = [number, number, number];

type SceneProps = {
  /** Rotación del maniquí alrededor del eje vertical, en radianes. */
  rotationY: number;
  /** Color base del maniquí (depende del tema). */
  color: string;
};

const A_POSE_ARM_ANGLE = 0.5; // ~29° respecto a la vertical

function Limb({
  position,
  rotationZ = 0,
  radius,
  length,
  color,
}: {
  position: Vec3;
  rotationZ?: number;
  radius: number;
  length: number;
  color: string;
}) {
  return (
    <mesh position={position} rotation={[0, 0, rotationZ]}>
      <capsuleGeometry args={[radius, length, 6, 16]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
    </mesh>
  );
}

function Arm({ side, color }: { side: 1 | -1; color: string }) {
  // Pivote en el hombro; el brazo cuelga hacia abajo y se abre en pose A.
  const upper = 0.26;
  const lower = 0.24;
  return (
    <group position={[side * 0.17, 1.41, 0]} rotation={[0, 0, side * A_POSE_ARM_ANGLE]}>
      <Limb position={[0, -upper / 2 - 0.04, 0]} radius={0.045} length={upper} color={color} />
      <Limb
        position={[0, -upper - lower / 2 - 0.1, 0]}
        radius={0.038}
        length={lower}
        color={color}
      />
      <mesh position={[0, -upper - lower - 0.17, 0]}>
        <sphereGeometry args={[0.045, 16, 12]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
    </group>
  );
}

function Leg({ side, color }: { side: 1 | -1; color: string }) {
  const thigh = 0.36;
  const shin = 0.34;
  return (
    <group position={[side * 0.09, 0.9, 0]}>
      <Limb position={[0, -thigh / 2 - 0.02, 0]} radius={0.07} length={thigh} color={color} />
      <Limb position={[0, -thigh - shin / 2 - 0.1, 0]} radius={0.05} length={shin} color={color} />
      <mesh position={[0, -0.87, 0.04]}>
        <boxGeometry args={[0.09, 0.05, 0.22]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  );
}

export function Mannequin({ color }: { color: string }) {
  return (
    <group>
      {/* Cabeza y cuello */}
      <mesh position={[0, 1.64, 0]} scale={[1, 1.15, 1]}>
        <sphereGeometry args={[0.1, 32, 24]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.045, 0.05, 0.08, 16]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {/* Torso: pecho y cadera */}
      <mesh position={[0, 1.25, 0]} scale={[1, 1, 0.62]}>
        <capsuleGeometry args={[0.16, 0.22, 8, 24]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.95, 0]} scale={[1, 0.8, 0.7]}>
        <sphereGeometry args={[0.17, 32, 24]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <Arm side={1} color={color} />
      <Arm side={-1} color={color} />
      <Leg side={1} color={color} />
      <Leg side={-1} color={color} />
    </group>
  );
}

/** Contenido del lienzo: luces, peana y maniquí. */
export function MannequinScene({ rotationY, color }: SceneProps) {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a8178', 0.9]} />
      <directionalLight position={[2, 4, 3]} intensity={1.6} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} />
      {/* Bajamos todo para que el centro del cuerpo quede en el origen de la cámara. */}
      <group position={[0, -0.88, 0]}>
        <group rotation={[0, rotationY, 0]}>
          <Mannequin color={color} />
        </group>
        <mesh position={[0, -0.015, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 0.03, 48]} />
          <meshStandardMaterial color="#8d8478" roughness={0.9} />
        </mesh>
      </group>
    </>
  );
}

/** Cámara común a ambas plataformas. */
export const CAMERA = { position: [0, 0.1, 3.3] as Vec3, fov: 38, near: 0.1, far: 50 };
