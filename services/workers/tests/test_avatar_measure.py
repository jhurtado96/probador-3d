"""Medición sobre mallas sintéticas de perímetro conocido (sin GPU)."""

import numpy as np
import pytest

from probador_workers.avatar import geometry, measure
from synthetic_body import CHEST, CROTCH_Y, HEIGHT, HIP, LEG_R, WAIST, ellipse_perimeter, loft, synthetic_body

N = 256  # lados de los anillos: el polígono inscrito subestima el perímetro en ~0,003 %


def test_cylinder_section_perimeter():
    r = 0.15
    v, f = loft([(0.0, r, r), (1.0, r, r)], n=N)
    loops = measure.plane_section(v, f, (0, 0.5, 0), (0, 1, 0))
    assert len(loops) == 1
    expected = 2 * N * r * np.sin(np.pi / N)
    assert measure.loop_perimeter(loops[0]) == pytest.approx(expected, rel=1e-6)
    assert measure.hull_perimeter_2d(loops[0][:, [0, 2]]) == pytest.approx(expected, rel=1e-6)


def test_elliptic_section_matches_ramanujan():
    a, b = 0.17, 0.11
    v, f = loft([(0.0, a, b), (1.0, a, b)], n=N)
    (lp,) = measure.plane_section(v, f, (0, 0.37, 0), (0, 1, 0))
    assert measure.loop_perimeter(lp) == pytest.approx(ellipse_perimeter(a, b), rel=1e-4)


def test_tilted_plane_gives_ellipse():
    r, ang = 0.05, np.radians(30)
    v, f = loft([(-1.0, r, r), (1.0, r, r)], n=N)
    normal = (np.sin(ang), np.cos(ang), 0.0)
    (lp,) = measure.plane_section(v, f, (0, 0, 0), normal)
    expected = ellipse_perimeter(r / np.cos(ang), r)
    assert measure.loop_perimeter(lp) == pytest.approx(expected, rel=1e-3)


def test_two_components_give_two_loops_and_hull_wraps_both():
    a = loft([(0, 0.07, 0.07), (1, 0.07, 0.07)], center=(-0.09, 0), n=N)
    b = loft([(0, 0.07, 0.07), (1, 0.07, 0.07)], center=(0.09, 0), n=N)
    v = np.concatenate([a[0], b[0]])
    f = np.concatenate([a[1], b[1] + len(a[0])])
    loops = measure.plane_section(v, f, (0, 0.5, 0), (0, 1, 0))
    assert len(loops) == 2
    hull = measure.hull_perimeter_2d(np.vstack([lp[:, [0, 2]] for lp in loops]))
    assert hull == pytest.approx(2 * 0.18 + 2 * np.pi * 0.07, rel=1e-3)  # como una cinta alrededor de las dos piernas


def test_concave_section_hull_bridges_concavity():
    # Sección en forma de "C": la cinta (envolvente) es más corta que el contorno real.
    pts = np.array([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0.6], [0.5, 0.6], [0.5, 0.4], [0, 0.4]], dtype=float)
    assert measure.hull_perimeter_2d(pts) == pytest.approx(4.0)
    assert measure.loop_perimeter(np.c_[pts[:, 0], np.zeros(len(pts)), pts[:, 1]]) == pytest.approx(5.0)


def test_point_in_polygon():
    sq = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=float)
    assert measure.point_in_polygon((0.5, 0.5), sq)
    assert not measure.point_in_polygon((1.5, 0.5), sq)


def test_synthetic_body_measurements():
    v, f, kp = synthetic_body()
    res = measure.measure_body(v, f, kp, step=0.0025)
    m = res.measurements_cm
    assert m["height_cm"] == pytest.approx(HEIGHT * 100, abs=0.1)
    assert m["chest_cm"] == pytest.approx(ellipse_perimeter(CHEST[1], CHEST[2]) * 100, abs=1.0)
    assert m["waist_cm"] == pytest.approx(ellipse_perimeter(WAIST[1], WAIST[2]) * 100, abs=1.0)
    assert m["hip_cm"] == pytest.approx(ellipse_perimeter(HIP[1], HIP[2]) * 100, abs=1.0)
    assert m["inseam_cm"] == pytest.approx(CROTCH_Y * 100, abs=0.5)
    assert m["arm_length_cm"] == pytest.approx((np.hypot(0.26, 0.02) + 0.27) * 100, abs=0.2)
    # hombros: media elipse posterior del corte a 1,41 m (semiejes interpolados entre los anillos 1,36 y 1,45)
    a, b = 0.165 - 0.015 * (0.05 / 0.09), 0.115 - 0.015 * (0.05 / 0.09)
    assert m["shoulder_width_cm"] == pytest.approx(ellipse_perimeter(a, b) / 2 * 100, abs=0.8)
    leg = 2 * np.pi * LEG_R * 100
    assert m["thigh_cm"] == pytest.approx(leg, abs=0.3)
    assert m["knee_cm"] == pytest.approx(leg, abs=0.3)
    assert m["calf_cm"] == pytest.approx(leg, abs=0.3)
    assert m["neck_cm"] == pytest.approx(2 * np.pi * 0.06 * 100, abs=0.3)
    assert m["bicep_cm"] == pytest.approx(2 * np.pi * 0.045 * 100, abs=0.3)
    assert m["wrist_cm"] == pytest.approx(2 * np.pi * 0.045 * 100, abs=0.3)
    assert not res.warnings


def test_uniform_scaling_to_declared_height_scales_every_length():
    v, f, kp = synthetic_body()
    base = measure.measure_body(v, f, kp, step=0.0025).measurements_cm
    v2, kp2, s = geometry.scale_to_height(v, kp, 1.60)
    assert s == pytest.approx(1.60 / HEIGHT)
    scaled = measure.measure_body(v2, f, kp2, step=0.0025).measurements_cm
    assert scaled["height_cm"] == pytest.approx(160.0, abs=0.1)
    for key in ("chest_cm", "waist_cm", "hip_cm", "inseam_cm", "arm_length_cm"):
        assert scaled[key] == pytest.approx(base[key] * s, abs=0.6), key


def test_placement_rotates_to_face_plus_z_and_puts_feet_on_floor():
    v, f, kp = synthetic_body()
    # el cuerpo mira a -X y flota 0,3 m
    rot = np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], dtype=float)  # +Z -> -X
    v_r = v @ rot.T + [0.5, 0.3, -0.2]
    kp_r = {k: p @ rot.T + [0.5, 0.3, -0.2] for k, p in kp.items()}
    R = geometry.facing_rotation(kp_r["nose"], kp_r["neck"])
    v_n, kp_n, _, _ = geometry.normalize_placement(v_r, kp_r, R)
    assert v_n[:, 1].min() == pytest.approx(0.0, abs=1e-9)
    assert kp_n["nose"][2] > kp_n["neck"][2]  # mira hacia +Z
    assert np.allclose(v_n, v + [0, 0, 0], atol=1e-9)  # vuelve exactamente al cuerpo original
    assert geometry.canonical_pose_name(kp_n) == "t_pose"


def test_missing_landmark_raises():
    v, f, kp = synthetic_body()
    del kp["left_acromion"]
    with pytest.raises(measure.MeasurementError):
        measure.measure_body(v, f, kp)


def test_volume_and_watertight():
    r, h = 0.1, 1.0
    v, f = loft([(0, r, r), (h, r, r)], n=N)
    assert geometry.is_watertight(f)
    assert geometry.mesh_volume(v, f) == pytest.approx(np.pi * r * r * h, rel=1e-3)
    assert not geometry.is_watertight(f[:-1])
