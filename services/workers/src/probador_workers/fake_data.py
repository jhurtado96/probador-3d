"""Artefactos y salidas FALSAS para pruebas de integración (`--fake`). Todo queda marcado como falso: el callback
lleva `fake: true` (marca estándar del contrato), `model_version`/`pipeline_version` empiezan por `fake/`
(FAKE_VERSION_PREFIX), confianza 0, medidas `unmeasured` y nombres `FAKE`."""

from __future__ import annotations

import json
import struct
import zlib
from datetime import datetime, timezone

FAKE_VERSION_PREFIX = "fake/"


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


def fake_sewing_pattern() -> bytes:
    """Especificación de patrón de pega (no es un GarmentCode válido; lo declara)."""
    return json.dumps({"format": "garmentcode", "generator": "probador-workers FAKE", "panels": {}, "stitches": []}).encode()


def fake_avatar(avatar_id: str, user_id: str, inp: dict, glb_ref: str) -> dict:
    ts = now_iso()
    zero = 0
    return {
        "avatar": {
            "id": avatar_id,
            "user_id": user_id,
            "body_model": "mhr",
            "model_version": FAKE_VERSION_PREFIX + "avatar-0",
            "shape": {"params": [0.0] * 45},
            "measurements": {
                "height_cm": inp["height_cm"], "chest_cm": zero, "waist_cm": zero, "hip_cm": zero,
                "shoulder_width_cm": zero, "arm_length_cm": zero, "inseam_cm": zero,
            },
            "measurements_source": "unmeasured",
            "glb_url": glb_ref,
            "pose": "a_pose",
            "shape_hash": "fake",
            "confidence": 0,
            "created_at": ts,
            "updated_at": ts,
        },
    }


def fake_garment(user_id: str | None, inp: dict, glb_ref: str, image_ref: str, pattern_ref: str) -> dict:
    ts = now_iso()
    size = inp.get("size_label")
    return {
        "garment": {
            "id": inp["garment_id"],
            "user_id": user_id,
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
            "sewing_pattern_url": pattern_ref,
            "sewing_pattern_format": "garmentcode",
            "pipeline_version": FAKE_VERSION_PREFIX + "garment-0",
            "created_at": ts,
            "updated_at": ts,
        },
        # Sin `embedding`: un vector inventado contaminaría la búsqueda por similitud.
    }


def fake_drape(job_id: str, user_id: str | None, inp: dict, cache_key: str, glb_ref: str) -> dict:
    import uuid

    out = {"glb_url": glb_ref, "cache_key": cache_key, "cache_hit": False}
    if user_id is None:  # catálogo: no hay dueño al que atribuir un FitResult
        return out
    return {
        **out,
        "fit_result": {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"fake-fit:{job_id}")),
            "user_id": user_id,
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


def fake_color(job_id: str, user_id: str, inp: dict) -> dict:
    import uuid

    ts = now_iso()
    return {
        "color_profile": {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"fake-color:{job_id}")),
            "user_id": user_id,
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
            "quality": {"flags": ["no_white_reference"], "capture_score": 0},
            "pipeline_version": FAKE_VERSION_PREFIX + "color-0",
            "created_at": ts,
            "updated_at": ts,
        },
    }
