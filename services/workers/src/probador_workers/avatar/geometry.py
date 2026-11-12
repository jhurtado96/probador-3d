"""Utilidades geométricas del avatar sin torch: escala a la altura, orientación, volumen, LOD y pose canónica."""

from __future__ import annotations

import numpy as np

from .measure import UP

DENSITY_KG_M3 = 985.0  # densidad media del cuerpo (docs/research/avatar.md §4; valor a calibrar en P1b)


def mesh_volume(verts: np.ndarray, faces: np.ndarray) -> float:
    """Volumen (m³ si los vértices están en metros) por el teorema de la divergencia. Exacto en mallas cerradas."""
    v = np.asarray(verts, dtype=np.float64)[np.asarray(faces)]
    return float(abs(np.einsum("ij,ij->i", v[:, 0], np.cross(v[:, 1], v[:, 2])).sum()) / 6.0)


def is_watertight(faces: np.ndarray) -> bool:
    """Cada arista compartida por exactamente dos triángulos."""
    f = np.asarray(faces, dtype=np.int64)
    e = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    _, counts = np.unique(e, axis=0, return_counts=True)
    return bool(np.all(counts == 2))


def facing_rotation(nose: np.ndarray, neck: np.ndarray) -> np.ndarray:
    """Rotación alrededor de Y que deja el cuerpo mirando hacia +Z (convención glTF)."""
    f = np.asarray(nose, dtype=np.float64) - np.asarray(neck, dtype=np.float64)
    ang = np.arctan2(f[0], f[2])  # ángulo de la mirada respecto a +Z
    c, s = np.cos(-ang), np.sin(-ang)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def normalize_placement(verts: np.ndarray, kp: dict[str, np.ndarray], rotation: np.ndarray | None = None):
    """Gira (opcional), pone los pies en y = 0 y centra la cadera en x = z = 0. Devuelve (verts, kp, R, t)."""
    R = np.eye(3) if rotation is None else np.asarray(rotation, dtype=np.float64)
    v = np.asarray(verts, dtype=np.float64) @ R.T
    hip = (np.asarray(kp["left_hip"]) + np.asarray(kp["right_hip"])) / 2 @ R.T
    t = np.array([-hip[0], -v[:, UP].min(), -hip[2]])
    return v + t, {n: np.asarray(p, dtype=np.float64) @ R.T + t for n, p in kp.items()}, R, t


def scale_to_height(verts: np.ndarray, kp: dict[str, np.ndarray], height_m: float):
    """Escala uniforme alrededor del origen (pies en y = 0) hasta la altura declarada. Devuelve (verts, kp, s)."""
    v = np.asarray(verts, dtype=np.float64)
    h = float(v[:, UP].max() - v[:, UP].min())
    if h <= 0:
        raise ValueError("malla sin altura")
    s = height_m / h
    return v * s, {n: np.asarray(p) * s for n, p in kp.items()}, s


def canonical_pose_name(kp: dict[str, np.ndarray]) -> str:
    """`t_pose`, `a_pose` o `relaxed` según el ángulo de los brazos bajo la horizontal (contrato `AvatarPose`)."""
    angles = []
    for s in ("left", "right"):
        a = np.asarray(kp[f"{s}_wrist"]) - np.asarray(kp[f"{s}_shoulder"])
        angles.append(np.degrees(np.arctan2(-a[UP], np.hypot(a[0], a[2]))))
    ang = float(np.mean(angles))
    if ang < 20:
        return "t_pose"
    if ang < 65:
        return "a_pose"
    return "relaxed"


def map_lod(source_verts: np.ndarray, source_faces: np.ndarray, triangle_ids: np.ndarray, bary: np.ndarray) -> np.ndarray:
    """Vértices de otro LOD de MHR a partir de LOD 1 con los mapeos baricéntricos oficiales (tools/mhr_LOD_conversion)."""
    tri = np.asarray(source_verts)[np.asarray(source_faces)[triangle_ids]]  # (n, 3, 3)
    return np.einsum("ijk,ij->ik", tri, bary)


def map_skinning(source_idx: np.ndarray, source_w: np.ndarray, source_faces: np.ndarray, triangle_ids: np.ndarray,
                 bary: np.ndarray, n_joints: int) -> tuple[np.ndarray, np.ndarray]:
    """Pesos de piel (4 influencias) para otro LOD, interpolando los de LOD 1 (como el visor web de MHR)."""
    corners = np.asarray(source_faces)[triangle_ids]  # (n, 3)
    n = len(corners)
    dense = np.zeros((n, n_joints), dtype=np.float32)
    rows = np.repeat(np.arange(n)[:, None], source_idx.shape[1], axis=1)
    for c in range(3):
        vi = corners[:, c]
        np.add.at(dense, (rows.reshape(-1), source_idx[vi].astype(np.int64).reshape(-1)),
                  (source_w[vi] * bary[:, c, None]).reshape(-1))
    return top4(np.broadcast_to(np.arange(n_joints), dense.shape), dense)


def top4(idx: np.ndarray, w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    order = np.argsort(w, axis=1)[:, ::-1][:, :4]
    i4 = np.take_along_axis(idx, order, axis=1)
    w4 = np.maximum(np.take_along_axis(w, order, axis=1), 0)
    if w4.shape[1] < 4:
        pad = 4 - w4.shape[1]
        i4 = np.pad(i4, ((0, 0), (0, pad)))
        w4 = np.pad(w4, ((0, 0), (0, pad)))
    sums = w4.sum(axis=1, keepdims=True)
    if np.any(sums <= 1e-8):
        raise ValueError("vértice sin influencia de piel")
    return i4.astype(np.uint16), (w4 / sums).astype(np.float32)


def skeleton_state_to_matrices(state: np.ndarray) -> np.ndarray:
    """Estado del esqueleto de MHR/momentum (J, 8) = [t(3), q(x,y,z,w), escala] -> matrices globales (J, 4, 4)."""
    t, q, s = state[:, :3], state[:, 3:7].astype(np.float64), state[:, 7]
    q = q / np.linalg.norm(q, axis=1, keepdims=True)
    x, y, z, w = q.T
    R = np.empty((len(state), 3, 3))
    R[:, 0, 0] = 1 - 2 * (y * y + z * z)
    R[:, 0, 1] = 2 * (x * y - z * w)
    R[:, 0, 2] = 2 * (x * z + y * w)
    R[:, 1, 0] = 2 * (x * y + z * w)
    R[:, 1, 1] = 1 - 2 * (x * x + z * z)
    R[:, 1, 2] = 2 * (y * z - x * w)
    R[:, 2, 0] = 2 * (x * z - y * w)
    R[:, 2, 1] = 2 * (y * z + x * w)
    R[:, 2, 2] = 1 - 2 * (x * x + y * y)
    M = np.repeat(np.eye(4)[None], len(state), axis=0)
    M[:, :3, :3] = R * s[:, None, None]
    M[:, :3, 3] = t
    return M


def transform_globals(M: np.ndarray, R: np.ndarray, t: np.ndarray, s: float) -> np.ndarray:
    """Lleva las matrices globales de las articulaciones al sistema de la malla final (x -> s * (R x + t)).

    La escala solo se aplica a las posiciones de las articulaciones, no a sus ejes: así los nodos del glTF no llevan
    escala y las matrices de bind inversas siguen siendo exactas para la malla escalada.
    """
    out = np.array(M, dtype=np.float64, copy=True)
    out[:, :3, :3] = np.einsum("ij,njk->nik", R, M[:, :3, :3])
    out[:, :3, 3] = s * (M[:, :3, 3] @ R.T + t)
    return out
