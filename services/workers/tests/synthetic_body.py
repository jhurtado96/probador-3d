"""Mallas sintéticas de medidas conocidas para probar la medición sin GPU."""

from __future__ import annotations

import numpy as np


def ellipse_perimeter(a: float, b: float) -> float:
    h = ((a - b) / (a + b)) ** 2
    return float(np.pi * (a + b) * (1 + 3 * h / (10 + np.sqrt(4 - 3 * h))))  # Ramanujan II


def loft(rings: list[tuple[float, float, float]], center=(0.0, 0.0), n: int = 256, axis: str = "y"):
    """Superficie cerrada por anillos elípticos: [(altura, semieje x, semieje z), ...] de abajo arriba.

    Con axis='x' el eje del sólido es X (la "altura" es x y los semiejes van en y, z): sirve para brazos en T.
    """
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    verts, faces = [], []
    for h, a, b in rings:
        c, s = a * np.cos(th), b * np.sin(th)
        if axis == "y":
            ring = np.stack([center[0] + c, np.full(n, h), center[1] + s], axis=1)
        else:
            ring = np.stack([np.full(n, h), center[0] + c, center[1] + s], axis=1)
        verts.append(ring)
    v = np.concatenate(verts)
    for r in range(len(rings) - 1):
        for i in range(n):
            a0, a1 = r * n + i, r * n + (i + 1) % n
            b0, b1 = a0 + n, a1 + n
            faces += [[a0, a1, b1], [a0, b1, b0]]
    # tapas
    bottom, top = len(v), len(v) + 1
    first = rings[0][0]
    last = rings[-1][0]
    if axis == "y":
        caps = np.array([[center[0], first, center[1]], [center[0], last, center[1]]])
    else:
        caps = np.array([[first, center[0], center[1]], [last, center[0], center[1]]])
    v = np.concatenate([v, caps])
    k = (len(rings) - 1) * n
    for i in range(n):
        faces.append([bottom, (i + 1) % n, i])
        faces.append([top, k + i, k + (i + 1) % n])
    return v, np.array(faces, dtype=np.int64)


def merge(*meshes):
    vs, fs, off = [], [], 0
    for v, f in meshes:
        vs.append(v)
        fs.append(f + off)
        off += len(v)
    return np.concatenate(vs), np.concatenate(fs)


# Medidas de diseño del cuerpo sintético (metros)
CHEST = (1.30, 0.17, 0.12)
WAIST = (1.05, 0.14, 0.10)
HIP = (0.88, 0.18, 0.12)
CROTCH_Y = 0.80
LEG_R = 0.07
LEG_X = 0.09
HEIGHT = 1.75


def synthetic_body():
    """Cuerpo en T: tronco con pecho/cintura/cadera elípticos, dos piernas, brazos horizontales, cuello y cabeza."""
    torso = loft([(CROTCH_Y, 0.15, 0.10), HIP, WAIST, (1.18, 0.15, 0.105), CHEST, (1.36, 0.165, 0.115), (1.45, 0.15, 0.10)])
    legs = [loft([(0.0, LEG_R, LEG_R), (CROTCH_Y - 0.001, LEG_R, LEG_R)], center=(x, 0.0)) for x in (-LEG_X, LEG_X)]
    arms = [loft([(x0, 0.045, 0.045), (x1, 0.045, 0.045)], center=(1.40, 0.0), axis="x") for x0, x1 in ((0.10, 0.80), (-0.80, -0.10))]
    neck = loft([(1.449, 0.06, 0.06), (1.56, 0.06, 0.06)])
    head = loft([(1.559, 0.08, 0.09), (HEIGHT, 0.08, 0.09)])
    v, f = merge(torso, *legs, *arms, neck, head)
    kp = {
        "nose": [0, 1.65, 0.09], "neck": [0, 1.47, 0],
        "left_shoulder": [0.17, 1.40, 0], "right_shoulder": [-0.17, 1.40, 0],
        "left_acromion": [0.19, 1.42, 0], "right_acromion": [-0.19, 1.42, 0],
        "left_elbow": [0.45, 1.40, 0], "right_elbow": [-0.45, 1.40, 0],
        "left_wrist": [0.72, 1.40, 0], "right_wrist": [-0.72, 1.40, 0],
        "left_hip": [LEG_X, 0.86, 0], "right_hip": [-LEG_X, 0.86, 0],
        "left_knee": [LEG_X, 0.45, 0], "right_knee": [-LEG_X, 0.45, 0],
        "left_ankle": [LEG_X, 0.06, 0], "right_ankle": [-LEG_X, 0.06, 0],
    }
    return v, f, {k: np.array(p, dtype=float) for k, p in kp.items()}
