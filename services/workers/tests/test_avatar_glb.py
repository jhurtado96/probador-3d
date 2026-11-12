"""Exportación GLB del avatar: estructura válida, Y arriba, metros y esqueleto con piel coherente (sin GPU)."""

import numpy as np
import pytest

from probador_workers.avatar import geometry, glb
from synthetic_body import loft


def _two_bone_rig(v):
    # raíz en el origen y un hijo a 1 m; cada vértice pesa sobre el hueso más cercano
    state = np.array([[0, 0, 0, 0, 0, 0, 1, 1], [0, 1.0, 0, 0, 0, 0, 1, 1]], dtype=float)
    G = geometry.skeleton_state_to_matrices(state)
    w_child = (v[:, 1] > 0.5).astype(np.float32)
    idx = np.tile(np.array([0, 1, 0, 0], dtype=np.uint16), (len(v), 1))
    w = np.stack([1 - w_child, w_child, np.zeros(len(v)), np.zeros(len(v))], axis=1).astype(np.float32)
    return glb.Rig(["root", "child"], np.array([-1, 0]), G, idx, w)


def test_glb_roundtrip_mesh_only():
    v, f = loft([(0.0, 0.1, 0.1), (1.7, 0.1, 0.1)], n=32)
    data = glb.export_glb(v, f)
    doc, binary = glb.read_glb(data)
    assert doc["asset"]["version"] == "2.0"
    prim = doc["meshes"][0]["primitives"][0]
    pos = glb.accessor_array(doc, binary, prim["attributes"]["POSITION"])
    assert np.allclose(pos, v, atol=1e-6)
    idx = glb.accessor_array(doc, binary, prim["indices"]).reshape(-1, 3)
    assert np.array_equal(idx, f)
    acc = doc["accessors"][prim["attributes"]["POSITION"]]
    assert acc["min"][1] == pytest.approx(0.0) and acc["max"][1] == pytest.approx(1.7)  # Y arriba, metros
    nrm = glb.accessor_array(doc, binary, prim["attributes"]["NORMAL"])
    assert np.allclose(np.linalg.norm(nrm, axis=1), 1, atol=1e-5)
    assert "skins" not in doc


def test_normals_point_outwards():
    v, f = loft([(0.0, 0.1, 0.1), (1.0, 0.1, 0.1)], n=32)
    n = glb.vertex_normals(v, f)
    side = (v[:, 1] > 0.01) & (v[:, 1] < 0.99)
    radial = v[side][:, [0, 2]]
    assert np.all(np.einsum("ij,ij->i", n[side][:, [0, 2]], radial) > 0)


def test_glb_with_skin():
    v, f = loft([(0.0, 0.1, 0.1), (2.0, 0.1, 0.1)], n=16)
    rig = _two_bone_rig(v)
    doc, binary = glb.read_glb(glb.export_glb(v, f, rig))
    skin = doc["skins"][0]
    assert skin["joints"] == [0, 1]
    assert doc["nodes"][0]["children"] == [1]
    ibm = glb.accessor_array(doc, binary, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    assert np.allclose(ibm[1] @ rig.global_matrices[1], np.eye(4), atol=1e-6)  # bind exacto
    local_child = np.array(doc["nodes"][1]["matrix"]).reshape(4, 4, order="F")
    assert np.allclose(local_child[:3, 3], [0, 1, 0])
    prim = doc["meshes"][0]["primitives"][0]
    w = glb.accessor_array(doc, binary, prim["attributes"]["WEIGHTS_0"])
    assert np.allclose(w.sum(axis=1), 1)


def test_transform_globals_keeps_bind_consistent_with_scaled_mesh():
    state = np.array([[0.1, 0.9, 0.0, 0, 0.3826834, 0, 0.9238795, 1.0]])  # 45° alrededor de Y
    G = geometry.skeleton_state_to_matrices(state)
    p_local = np.array([0.2, 0.1, -0.05, 1.0])
    p_world = G[0] @ p_local
    R = geometry.facing_rotation(np.array([1.0, 0, 0]), np.zeros(3))  # mirar a +X -> girar a +Z
    t, s = np.array([0.0, 0.2, 0.0]), 1.1
    G2 = geometry.transform_globals(G, R, t, s)
    # El vértice transformado igual que la malla queda en la misma posición local (escalada) respecto a la articulación
    v2 = s * (R @ p_world[:3] + t)
    assert np.allclose(np.linalg.inv(G2[0]) @ np.r_[v2, 1], np.r_[s * p_local[:3], 1])
    assert np.allclose(np.linalg.det(G2[0][:3, :3]), np.linalg.det(G[0][:3, :3]))  # sin escala en los ejes


def test_lod_mapping_and_skinning_interpolation():
    src = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=float)
    faces = np.array([[0, 1, 2]])
    tri_ids = np.array([0, 0])
    bary = np.array([[1, 0, 0], [1 / 3, 1 / 3, 1 / 3]])
    out = geometry.map_lod(src, faces, tri_ids, bary)
    assert np.allclose(out, [[0, 0, 0], [1 / 3, 1 / 3, 0]])
    idx = np.array([[0, 1, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0]], dtype=np.uint16)
    w = np.array([[0.5, 0.5, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]], dtype=np.float32)
    i4, w4 = geometry.map_skinning(idx, w, faces, tri_ids, bary, 3)
    assert np.allclose(w4.sum(axis=1), 1)
    # vértice central: joint 1 = 1/3*0.5 + 1/3 = 0.5, joint 0 = 1/6, joint 2 = 1/3
    d: dict[int, float] = {}
    for j, wj in zip(i4[1].tolist(), w4[1].tolist()):
        d[j] = d.get(j, 0.0) + wj
    assert d[1] == pytest.approx(0.5) and d[2] == pytest.approx(1 / 3) and d[0] == pytest.approx(1 / 6)


def test_invalid_mesh_rejected():
    with pytest.raises(ValueError):
        glb.export_glb(np.zeros((3, 3)), np.array([[0, 1, 5]]))
