"""Artefactos y salidas FALSAS para pruebas de integración (`--fake`). Todo queda marcado como falso:
`worker_version` y `pipeline_version`/`model_version` empiezan por `fake`, confianza 0, nombres `FAKE`."""

from __future__ import annotations

import json
import struct
import zlib
from datetime import datetime, timezone

FAKE_TAG = "fake"
NIL_UUID = "00000000-0000-0000-0000-000000000000"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def minimal_glb() -> bytes:
    """GLB 2.0 válido con un solo triángulo; `generator` lo declara falso."""
    positions = struct.pack("<9f", 0, 0, 0, 0.1, 0, 0, 0, 0.1, 0)
    doc = {
        "asset": {"version": "2.0", "generator": "probador-workers FAKE"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "FAKE"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [0, 0, 0], "max": [0.1, 0.1, 0]}],
        "bufferViews": [{"buffer": 0, "byteLength": len(positions), "target": 34962}],
        "buffers": [{"byteLength": len(positions)}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(positions)
    return (
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<I4s", len(js), b"JSON") + js
        + struct.pack("<I4s", len(positions), b"BIN\x00") + positions
    )


def minimal_png() -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    raw = b"\x00\x80\x80\x80"  # 1x1 gris
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def fake_avatar(avatar_id: str, inp: dict, glb_ref: str) -> dict:
    ts = now_iso()
    zero = 0
    return {
        "avatar": {
            "id": avatar_id,
            "user_id": NIL_UUID,  # el dispatch no trae user_id: la API debe fijarlo (ver informe)
            "body_model": "smplx",
            "model_version": "fake/avatar-0",
            "smplx": {"gender": inp.get("gender", "neutral"), "betas": [0.0] * 10},
            "measurements": {
                "height_cm": inp["height_cm"], "chest_cm": zero, "waist_cm": zero, "hip_cm": zero,
                "shoulder_width_cm": zero, "arm_length_cm": zero, "inseam_cm": zero,
            },
            "measurements_source": "manual",
            "glb_url": glb_ref,
            "pose": "a_pose",
            "shape_hash": "fake",
            "confidence": 0,
            "created_at": ts,
            "updated_at": ts,
        },
        "input_deleted_at": ts,
    }


def fake_garment(inp: dict, glb_ref: str, image_ref: str) -> dict:
    ts = now_iso()
    size = inp.get("size_label")
    return {
        "garment": {
            "id": inp["garment_id"],
            "user_id": NIL_UUID,
            "status": "ready",
            "category": inp.get("category_hint", "tshirt"),
            "name": "FAKE garment",
            "attributes": {"tags": ["fake"]},
            "colors": [{"lab": {"l": 50, "a": 0, "b": 0}, "hex": "#808080", "proportion": 1, "name": "FAKE gris"}],
            "design_fit": "regular",
            "size_label": size,
            "measurements": [{"size_label": size, "zones": {}, "source": "estimated"}] if size else [],
            "level": 1,
            "image_url": image_ref,
            "glb_url": glb_ref,
            "pipeline_version": "fake/garment-0",
            "created_at": ts,
            "updated_at": ts,
        },
        "input_deleted_at": ts,
    }


def fake_drape(job_id: str, inp: dict, glb_ref: str) -> dict:
    import uuid

    return {
        "glb_url": glb_ref,
        "cache_key": f"fake:{job_id}",
        "cache_hit": False,
        "fit_result": {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"fake-fit:{job_id}")),
            "avatar_id": inp["avatar_id"],
            "garment_id": inp["garment_id"],
            "size_label": inp["size_label"],
            "zones": [{"zone": "chest", "body_cm": 0, "garment_cm": 0, "ease_cm": 0, "verdict": "ideal"}],
            "verdict": "fits",
            "effective_fit": "regular",
            "matches_design_fit": True,
            "score": 0,
            "method": "size_chart",
            "confidence": 0,
            "created_at": now_iso(),
        },
    }


def fake_color(job_id: str, inp: dict) -> dict:
    import uuid

    ts = now_iso()
    return {
        "color_profile": {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"fake-color:{job_id}")),
            "user_id": NIL_UUID,
            "season": "soft_summer",
            "undertone": "neutral",
            "value": "medium",
            "intensity": "medium",
            "contrast": "medium",
            "scores": {"undertone": 0, "value": 0.5, "intensity": 0.5, "contrast": 0.5},
            "skin_lab": {"l": 50, "a": 0, "b": 0},
            "palettes": {"best": ["#808080"], "neutrals": [], "accents": [], "avoid": []},
            "metal": "any",
            "confidence": 0,
            "white_balanced": False,
            "pipeline_version": "fake/color-0",
            "created_at": ts,
        },
        "input_deleted_at": ts,
    }
