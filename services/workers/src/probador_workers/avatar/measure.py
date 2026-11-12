"""Medidas corporales sobre una malla en pose canónica, independientes de la topología (docs/research/avatar.md §5).

Entrada: vértices en METROS con Y arriba y el suelo en y = min(y), caras triangulares y unos pocos puntos de
referencia (articulaciones y puntos anatómicos de MHR70) en el mismo sistema. Nada aquí conoce la topología de MHR:
los perímetros salen de cortes planos de la malla y las longitudes, de distancias entre puntos de referencia.

Definiciones (aproximación de ISO 8559-1 para el prototipo; se calibran en P1c con voluntarios medidos con cinta):
- pecho: máximo contorno horizontal del tronco entre axila y mitad del tronco, con envolvente convexa (cinta métrica);
- cintura: mínimo contorno horizontal del tronco entre cadera y pecho (envolvente convexa);
- cadera: máximo contorno horizontal alrededor de nalgas (envolvente convexa de tronco y piernas, sin manos);
- entrepierna: altura de la horquilla (donde el corte horizontal se separa en dos piernas) al suelo;
- hombros: de acromion a acromion por la espalda (contorno posterior del corte a la altura de los acromion);
- brazo: acromion -> codo -> muñeca;
- cuello, bíceps, muñeca, muslo, rodilla, gemelo: contornos con plano horizontal o perpendicular al eje del hueso.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

UP = 1  # eje Y


class MeasurementError(ValueError):
    """No se pudo tomar una medida obligatoria (malla o puntos de referencia inesperados)."""


# ---------------------------------------------------------------------------
# Geometría básica
# ---------------------------------------------------------------------------


def plane_section(verts: np.ndarray, faces: np.ndarray, origin, normal) -> list[np.ndarray]:
    """Intersección de una malla triangular con un plano: lista de bucles (k, 3), sin repetir el primer punto.

    Se enlazan los segmentos de cada triángulo cortado por las aristas que comparten, así que una malla con varias
    piezas (o un cuerpo con brazos separados del tronco) da un bucle por pieza. Los vértices que caen justo en el plano
    se desplazan un epsilon para que ningún corte sea degenerado.
    """
    n = np.asarray(normal, dtype=np.float64)
    n = n / np.linalg.norm(n)
    d = (np.asarray(verts, dtype=np.float64) - np.asarray(origin, dtype=np.float64)) @ n
    d = np.where(np.abs(d) < 1e-12, 1e-12, d)
    df = d[faces]
    pos = df > 0
    crossing = pos.any(axis=1) & (~pos).any(axis=1)
    if not crossing.any():
        return []
    fc = faces[crossing]
    dc = df[crossing]
    nv = len(verts)
    seg_keys = []  # por cara cortada: las dos claves de arista
    for a, b in ((0, 1), (1, 2), (2, 0)):
        cut = (dc[:, a] > 0) != (dc[:, b] > 0)
        i, j = fc[:, a], fc[:, b]
        lo, hi = np.minimum(i, j), np.maximum(i, j)
        seg_keys.append(np.where(cut, lo.astype(np.int64) * nv + hi, -1))
    keys = np.stack(seg_keys, axis=1)  # (C, 3), exactamente dos != -1 por fila
    pairs = np.sort(keys, axis=1)[:, 1:]  # las dos aristas cortadas

    # Punto de corte por arista.
    uniq = np.unique(pairs.reshape(-1))
    lo, hi = uniq // nv, uniq % nv
    t = d[lo] / (d[lo] - d[hi])
    pts = verts[lo] + (verts[hi] - verts[lo]) * t[:, None]
    idx = {int(k): p for p, k in enumerate(uniq)}

    adj: dict[int, list[int]] = {}
    for a, b in pairs:
        ia, ib = idx[int(a)], idx[int(b)]
        adj.setdefault(ia, []).append(ib)
        adj.setdefault(ib, []).append(ia)

    seen = np.zeros(len(uniq), dtype=bool)
    loops = []
    for start in range(len(uniq)):
        if seen[start]:
            continue
        loop = [start]
        seen[start] = True
        prev, cur = -1, start
        while True:
            nxt = [v for v in adj.get(cur, []) if v != prev and not seen[v]]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen[cur] = True
            loop.append(cur)
        if len(loop) >= 3:
            loops.append(pts[loop])
    return loops


def loop_perimeter(points: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(np.vstack([points, points[:1]]), axis=0), axis=1).sum())


def _plane_basis(normal) -> tuple[np.ndarray, np.ndarray]:
    n = np.asarray(normal, dtype=np.float64)
    n = n / np.linalg.norm(n)
    helper = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 0, 1.0])
    u = np.cross(n, helper)
    u /= np.linalg.norm(u)
    return u, np.cross(n, u)


def project_2d(points: np.ndarray, normal) -> np.ndarray:
    if np.allclose(np.abs(np.asarray(normal, dtype=float) / np.linalg.norm(normal)), [0, 1, 0]):
        return points[:, [0, 2]]  # corte horizontal: plano XZ
    u, v = _plane_basis(normal)
    return np.stack([points @ u, points @ v], axis=1)


def _cross2(a: np.ndarray, b: np.ndarray) -> float:
    return float(a[0] * b[1] - a[1] * b[0])


def convex_hull_2d(pts: np.ndarray) -> np.ndarray:
    """Envolvente convexa (cadena monótona de Andrew), en orden antihorario."""
    p = np.unique(np.round(np.asarray(pts, dtype=np.float64), 9), axis=0)
    if len(p) < 3:
        return p
    p = p[np.lexsort((p[:, 1], p[:, 0]))]

    def half(seq):
        out: list[np.ndarray] = []
        for q in seq:
            while len(out) >= 2 and _cross2(out[-1] - out[-2], q - out[-2]) <= 0:
                out.pop()
            out.append(q)
        return out

    lower, upper = half(p), half(p[::-1])
    return np.array(lower[:-1] + upper[:-1])


def hull_perimeter_2d(pts: np.ndarray) -> float:
    h = convex_hull_2d(pts)
    if len(h) < 2:
        return 0.0
    return loop_perimeter(h)


def point_in_polygon(pt, poly2d: np.ndarray) -> bool:
    x, y = float(pt[0]), float(pt[1])
    xs, ys = poly2d[:, 0], poly2d[:, 1]
    xs2, ys2 = np.roll(xs, -1), np.roll(ys, -1)
    cond = (ys > y) != (ys2 > y)
    with np.errstate(divide="ignore", invalid="ignore"):
        xint = xs + (y - ys) * (xs2 - xs) / (ys2 - ys)
    return bool(np.count_nonzero(cond & (x < xint)) % 2)


# ---------------------------------------------------------------------------
# Cortes horizontales con información de cada bucle
# ---------------------------------------------------------------------------


@dataclass
class Loop:
    points: np.ndarray  # (k, 3)
    xz: np.ndarray  # (k, 2)
    centroid: np.ndarray  # (2,) en XZ
    perimeter: float
    hull_perimeter: float
    width_x: float


def horizontal_loops(verts, faces, y: float) -> list[Loop]:
    out = []
    for lp in plane_section(verts, faces, (0.0, y, 0.0), (0.0, 1.0, 0.0)):
        xz = lp[:, [0, 2]]
        out.append(
            Loop(lp, xz, xz.mean(axis=0), loop_perimeter(lp), hull_perimeter_2d(xz), float(np.ptp(xz[:, 0])))
        )
    return out


def _torso_loop(loops: list[Loop], center_xz) -> Loop | None:
    inside = [lp for lp in loops if point_in_polygon(center_xz, lp.xz)]
    if inside:
        return min(inside, key=lambda lp: lp.perimeter)  # el bucle más interior que contiene el eje
    return None


def _nearest_loop(loops: list[Loop], xz) -> Loop | None:
    if not loops:
        return None
    return min(loops, key=lambda lp: float(np.linalg.norm(lp.centroid - np.asarray(xz))))


# ---------------------------------------------------------------------------
# Medición del cuerpo
# ---------------------------------------------------------------------------

REQUIRED = ("height_cm", "chest_cm", "waist_cm", "hip_cm", "shoulder_width_cm", "arm_length_cm", "inseam_cm")

# Puntos de referencia que necesita measure_body (nombres de MHR70; ver sam_3d_body/metadata/mhr70.py).
LANDMARKS = (
    "nose", "neck",
    "left_shoulder", "right_shoulder", "left_acromion", "right_acromion",
    "left_elbow", "right_elbow", "left_wrist", "right_wrist",
    "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
)


@dataclass
class BodyMeasurementResult:
    measurements_cm: dict[str, float]
    levels_m: dict[str, float] = field(default_factory=dict)  # alturas de corte usadas (diagnóstico)
    warnings: list[str] = field(default_factory=list)


def _levels(lo: float, hi: float, step: float) -> np.ndarray:
    if hi <= lo:
        return np.array([lo])
    return np.arange(lo, hi + 1e-9, step)


def measure_body(verts: np.ndarray, faces: np.ndarray, kp: dict[str, np.ndarray], step: float = 0.004) -> BodyMeasurementResult:
    """Mide el cuerpo. `verts` en metros, Y arriba; `kp` con los LANDMARKS en el mismo sistema."""
    verts = np.asarray(verts, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int64)
    missing = [k for k in LANDMARKS if k not in kp]
    if missing:
        raise MeasurementError(f"faltan puntos de referencia: {missing}")
    k = {name: np.asarray(v, dtype=np.float64) for name, v in kp.items()}
    y_floor, y_top = float(verts[:, UP].min()), float(verts[:, UP].max())
    res = BodyMeasurementResult(measurements_cm={})
    m = res.measurements_cm
    m["height_cm"] = (y_top - y_floor) * 100

    sh = (k["left_shoulder"] + k["right_shoulder"]) / 2
    hp = (k["left_hip"] + k["right_hip"]) / 2
    y_sh, y_hip = float(sh[UP]), float(hp[UP])
    d = y_sh - y_hip
    if d <= 0.05:
        raise MeasurementError("hombros por debajo de la cadera: la malla no está en pose canónica de pie")
    center = ((sh + hp) / 2)[[0, 2]]
    hip_center = hp[[0, 2]]
    hip_sep = float(abs(k["left_hip"][0] - k["right_hip"][0]))
    acr_dist = float(np.linalg.norm(k["left_acromion"] - k["right_acromion"]))
    hands = [k["left_wrist"], k["right_wrist"]]

    # --- pecho y cintura: tronco
    def torso_at(y):
        lp = _torso_loop(horizontal_loops(verts, faces, y), center)
        if lp is None or lp.width_x > 1.25 * acr_dist:
            return None  # sin tronco o con los brazos pegados al corte
        return lp

    best = None
    for y in _levels(y_sh - 0.5 * d, y_sh - 0.1 * d, step):
        lp = torso_at(y)
        if lp is not None and (best is None or lp.hull_perimeter > best[1]):
            best = (y, lp.hull_perimeter)
    if best:
        res.levels_m["chest"] = best[0]
        m["chest_cm"] = best[1] * 100
    y_chest = best[0] if best else y_sh - 0.3 * d

    best = None
    for y in _levels(y_hip + 0.15 * d, min(y_hip + 0.65 * d, y_chest - 0.02), step):
        lp = torso_at(y)
        if lp is not None and (best is None or lp.hull_perimeter < best[1]):
            best = (y, lp.hull_perimeter)
    if best:
        res.levels_m["waist"] = best[0]
        m["waist_cm"] = best[1] * 100

    # --- cadera: envolvente de tronco + piernas, sin manos ni brazos
    def lower_loops(y):
        out = []
        for lp in horizontal_loops(verts, faces, y):
            if abs(lp.centroid[0] - hip_center[0]) > 1.1 * max(hip_sep, 0.12):
                continue
            if any(abs(h[UP] - y) < 0.15 and np.linalg.norm(lp.centroid - h[[0, 2]]) < 0.09 for h in hands):
                continue
            out.append(lp)
        return out

    best = None
    for y in _levels(y_hip - 0.3 * d, y_hip + 0.12 * d, step):
        lps = lower_loops(y)
        if not lps:
            continue
        per = hull_perimeter_2d(np.vstack([lp.xz for lp in lps]))
        if best is None or per > best[1]:
            best = (y, per)
    if best:
        res.levels_m["hip"] = best[0]
        m["hip_cm"] = best[1] * 100

    # --- entrepierna: la altura más alta por debajo de la cadera con dos piernas separadas
    y_knee = float((k["left_knee"][UP] + k["right_knee"][UP]) / 2)
    crotch = None
    for y in _levels(y_knee, y_hip, step / 2)[::-1]:
        lps = lower_loops(y)
        left = [lp for lp in lps if lp.centroid[0] - hip_center[0] > 0.01]
        right = [lp for lp in lps if lp.centroid[0] - hip_center[0] < -0.01]
        if left and right and not any(point_in_polygon(hip_center, lp.xz) for lp in lps):
            crotch = y
            break
    if crotch is not None:
        res.levels_m["crotch"] = crotch
        m["inseam_cm"] = (crotch - y_floor) * 100

    # --- hombros: contorno posterior a la altura de los acromion, entre ambos
    front = np.sign((k["nose"] - k["neck"])[2]) or 1.0
    y_acr = float((k["left_acromion"][UP] + k["right_acromion"][UP]) / 2)
    x_lo, x_hi = sorted([float(k["left_acromion"][0]), float(k["right_acromion"][0])])
    lp = _nearest_loop([lp for lp in horizontal_loops(verts, faces, y_acr - 0.01)
                        if point_in_polygon(center, lp.xz)], center)
    back_len = None
    if lp is not None:
        p = lp.xz
        q = np.roll(p, -1, axis=0)
        mid = (p + q) / 2
        z_mid = float(center[1])
        sel = (mid[:, 0] >= x_lo) & (mid[:, 0] <= x_hi) & (front * (mid[:, 1] - z_mid) < 0)
        if sel.any():
            back_len = float(np.linalg.norm(q[sel] - p[sel], axis=1).sum())
    if back_len is None or back_len < acr_dist:
        res.warnings.append("shoulder_fallback_straight")
        back_len = acr_dist
    m["shoulder_width_cm"] = back_len * 100

    # --- brazo: acromion -> codo -> muñeca (media de ambos lados)
    arms = []
    for s in ("left", "right"):
        arms.append(np.linalg.norm(k[f"{s}_elbow"] - k[f"{s}_acromion"]) + np.linalg.norm(k[f"{s}_wrist"] - k[f"{s}_elbow"]))
    m["arm_length_cm"] = float(np.mean(arms)) * 100

    # --- opcionales
    def bone_girth(a, b, frac, near=None):
        p = k[a] + (k[b] - k[a]) * frac
        nrm = k[b] - k[a]
        loops = plane_section(verts, faces, p, nrm)
        if not loops:
            return None
        lp = min(loops, key=lambda L: float(np.linalg.norm(L.mean(axis=0) - (near if near is not None else p))))
        return hull_perimeter_2d(project_2d(lp, nrm))

    def avg(vals):
        vals = [v for v in vals if v]
        return float(np.mean(vals)) * 100 if vals else None

    optional = {
        "bicep_cm": avg([bone_girth(f"{s}_shoulder", f"{s}_elbow", 0.5) for s in ("left", "right")]),
        "wrist_cm": avg([bone_girth(f"{s}_elbow", f"{s}_wrist", 0.97) for s in ("left", "right")]),
    }
    neck_loops = horizontal_loops(verts, faces, float(k["neck"][UP]) + 0.02)
    nl = _torso_loop(neck_loops, k["neck"][[0, 2]]) or _nearest_loop(neck_loops, k["neck"][[0, 2]])
    optional["neck_cm"] = nl.hull_perimeter * 100 if nl else None

    def leg_girth(y, side_points):
        lps = lower_loops(y)
        vals = []
        for pt in side_points:
            lp = _nearest_loop(lps, pt[[0, 2]])
            if lp is not None and not point_in_polygon(hip_center, lp.xz):
                vals.append(lp.hull_perimeter)
        return float(np.mean(vals)) * 100 if vals else None

    knees = [k["left_knee"], k["right_knee"]]
    if crotch is not None:
        optional["thigh_cm"] = leg_girth(crotch - 0.025, knees)
    optional["knee_cm"] = leg_girth(y_knee, knees)
    y_ankle = float((k["left_ankle"][UP] + k["right_ankle"][UP]) / 2)
    calves = [leg_girth(y, knees) for y in _levels(y_ankle + 0.3 * (y_knee - y_ankle), y_knee - 0.1 * (y_knee - y_ankle), step)]
    calves = [c for c in calves if c]
    optional["calf_cm"] = max(calves) if calves else None
    for key, val in optional.items():
        if val is not None and np.isfinite(val) and val > 0:
            m[key] = val

    lost = [key for key in REQUIRED if key not in m]
    if lost:
        raise MeasurementError(f"no se pudieron medir: {lost}")
    res.measurements_cm = {key: round(float(v), 1) for key, v in m.items()}
    return res
