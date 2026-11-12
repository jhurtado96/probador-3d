"""Exportación GLB 2.0 del avatar (perfil universal, docs/architecture.md §1.3): malla en metros, Y arriba, mirando a
+Z, pies en el origen; normales por vértice; material neutro sin texturas; esqueleto con piel opcional.

Escrito con numpy, sin dependencias de 3D. La parte del esqueleto sigue el exportador del visor web de MHR
(facebookresearch/MHR, web-viewer/exporters.py, Apache 2.0).
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass

import numpy as np

GENERATOR = "probador-workers avatar"
NEUTRAL_RGBA = [0.78, 0.74, 0.71, 1.0]


@dataclass(frozen=True)
class Rig:
    joint_names: list[str]
    joint_parents: np.ndarray  # (J,), -1 en las raíces; el padre siempre antes que el hijo
    global_matrices: np.ndarray  # (J, 4, 4) en pose de bind, mismo sistema que los vértices
    joint_indices: np.ndarray  # (N, 4) uint16
    joint_weights: np.ndarray  # (N, 4) float32, suman 1


def vertex_normals(verts: np.ndarray, faces: np.ndarray) -> np.ndarray:
    v = np.asarray(verts, dtype=np.float64)
    f = np.asarray(faces, dtype=np.int64)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])  # ponderadas por área
    n = np.zeros_like(v)
    for c in range(3):
        np.add.at(n, f[:, c], fn)
    norm = np.linalg.norm(n, axis=1, keepdims=True)
    n = np.where(norm > 1e-12, n / np.maximum(norm, 1e-12), np.array([0.0, 1.0, 0.0]))
    return n.astype(np.float32)


class _Builder:
    def __init__(self) -> None:
        self.payload = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def add(self, arr: np.ndarray, component: int, typ: str, target: int | None = None, bounds: bool = False) -> int:
        while len(self.payload) % 4:
            self.payload.append(0)
        raw = np.ascontiguousarray(arr).tobytes()
        view = {"buffer": 0, "byteOffset": len(self.payload), "byteLength": len(raw)}
        if target is not None:
            view["target"] = target
        self.payload.extend(raw)
        self.views.append(view)
        acc = {"bufferView": len(self.views) - 1, "componentType": component, "count": int(len(arr)), "type": typ}
        if bounds:
            acc["min"] = np.asarray(arr).min(axis=0).astype(float).tolist()
            acc["max"] = np.asarray(arr).max(axis=0).astype(float).tolist()
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def build(self, doc: dict) -> bytes:
        while len(self.payload) % 4:
            self.payload.append(0)
        doc["buffers"] = [{"byteLength": len(self.payload)}]
        doc["bufferViews"] = self.views
        doc["accessors"] = self.accessors
        js = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
        js += b" " * (-len(js) % 4)
        bin_ = bytes(self.payload)
        total = 12 + 8 + len(js) + 8 + len(bin_)
        return b"".join([
            struct.pack("<4sII", b"glTF", 2, total),
            struct.pack("<I4s", len(js), b"JSON"), js,
            struct.pack("<I4s", len(bin_), b"BIN\x00"), bin_,
        ])


def export_glb(verts: np.ndarray, faces: np.ndarray, rig: Rig | None = None, name: str = "avatar",
               extras: dict | None = None) -> bytes:
    v = np.asarray(verts, dtype="<f4")
    f = np.asarray(faces)
    if v.ndim != 2 or v.shape[1] != 3 or f.ndim != 2 or f.shape[1] != 3:
        raise ValueError("malla inválida")
    if not np.isfinite(v).all() or f.min() < 0 or f.max() >= len(v):
        raise ValueError("malla inválida")
    b = _Builder()
    attrs = {
        "POSITION": b.add(v, 5126, "VEC3", 34962, bounds=True),
        "NORMAL": b.add(vertex_normals(v, f).astype("<f4"), 5126, "VEC3", 34962),
    }
    idx_dtype, idx_comp = ("<u2", 5123) if len(v) < 65535 else ("<u4", 5125)
    indices = b.add(f.astype(idx_dtype).reshape(-1), idx_comp, "SCALAR", 34963)
    doc: dict = {
        "asset": {"version": "2.0", "generator": GENERATOR},
        "scene": 0,
        "materials": [{"name": "neutral", "pbrMetallicRoughness": {"baseColorFactor": NEUTRAL_RGBA,
                                                                   "metallicFactor": 0.0, "roughnessFactor": 0.85}}],
        "meshes": [{"name": name, "primitives": [{"attributes": attrs, "indices": indices, "material": 0, "mode": 4}]}],
    }
    nodes: list[dict] = []
    roots: list[int] = []
    if rig is not None:
        J = len(rig.joint_names)
        parents = np.asarray(rig.joint_parents, dtype=np.int64)
        G = np.asarray(rig.global_matrices, dtype=np.float64)
        if G.shape != (J, 4, 4) or parents.shape != (J,):
            raise ValueError("esqueleto inválido")
        if rig.joint_indices.shape != (len(v), 4) or rig.joint_weights.shape != (len(v), 4):
            raise ValueError("pesos de piel inválidos")
        if any(p >= i or p < -1 for i, p in enumerate(parents)):
            raise ValueError("los padres deben ir antes que los hijos")
        inv = np.linalg.inv(G)
        for i in range(J):
            local = G[i] if parents[i] < 0 else inv[parents[i]] @ G[i]
            node = {"name": str(rig.joint_names[i]), "matrix": local.reshape(-1, order="F").astype(float).tolist()}
            children = np.flatnonzero(parents == i).tolist()
            if children:
                node["children"] = [int(c) for c in children]
            nodes.append(node)
        roots = [int(i) for i in np.flatnonzero(parents < 0)]
        attrs["JOINTS_0"] = b.add(np.asarray(rig.joint_indices, dtype="<u2"), 5123, "VEC4", 34962)
        attrs["WEIGHTS_0"] = b.add(np.asarray(rig.joint_weights, dtype="<f4"), 5126, "VEC4", 34962)
        ibm = np.stack([m.reshape(-1, order="F") for m in inv]).astype("<f4")
        doc["skins"] = [{"name": "skeleton", "inverseBindMatrices": b.add(ibm, 5126, "MAT4"),
                         "joints": list(range(J)), "skeleton": roots[0]}]
        nodes.append({"name": name, "mesh": 0, "skin": 0})
    else:
        nodes.append({"name": name, "mesh": 0})
    roots.append(len(nodes) - 1)
    doc["nodes"] = nodes
    doc["scenes"] = [{"name": name, "nodes": roots}]
    if extras:
        doc["asset"]["extras"] = extras
    return b.build(doc)


def read_glb(data: bytes) -> tuple[dict, bytes]:
    """Lee un GLB (para pruebas y para el informe de la prueba real): (documento JSON, buffer binario)."""
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or total != len(data):
        raise ValueError("no es un GLB 2.0")
    jl, jt = struct.unpack_from("<I4s", data, 12)
    if jt != b"JSON":
        raise ValueError("falta el bloque JSON")
    doc = json.loads(data[20:20 + jl])
    off = 20 + jl
    bl, bt = struct.unpack_from("<I4s", data, off)
    if bt != b"BIN\x00":
        raise ValueError("falta el bloque BIN")
    return doc, data[off + 8: off + 8 + bl]


def accessor_array(doc: dict, binary: bytes, index: int) -> np.ndarray:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    dtype = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[acc["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    arr = np.frombuffer(binary, dtype=dtype, count=acc["count"] * width, offset=start)
    return arr.reshape(acc["count"], width) if width > 1 else arr
