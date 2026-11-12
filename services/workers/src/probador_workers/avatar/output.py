"""Resultado del pipeline y su traducción a `AvatarJobOutput` (contrato `packages/contracts`)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from . import PIPELINE_VERSION

# Incertidumbre (1σ, cm) de partida del prototipo, con una sola foto frontal, ropa normal y SIN ajuste por silueta.
# Sale de docs/research/avatar.md §6 (perímetros 3–5 cm con una foto vestida; longitudes < 2 cm con la altura
# conocida) y es deliberadamente conservadora: aún no hay validación con voluntarios (P1c). La altura es la declarada.
BASE_SIGMA_CM = {
    "height_cm": 1.0,
    "chest_cm": 5.0,
    "waist_cm": 6.0,
    "hip_cm": 5.0,
    "shoulder_width_cm": 2.5,
    "arm_length_cm": 2.5,
    "inseam_cm": 3.0,
    "neck_cm": 2.5,
    "bicep_cm": 2.5,
    "wrist_cm": 1.5,
    "thigh_cm": 4.0,
    "knee_cm": 2.5,
    "calf_cm": 3.0,
}
GIRTHS = {"chest_cm", "waist_cm", "hip_cm", "neck_cm", "bicep_cm", "wrist_cm", "thigh_cm", "knee_cm", "calf_cm"}
# Techo de la confianza mientras el pipeline no esté calibrado con voluntarios medidos con cinta (P1c).
CONFIDENCE_CAP = 0.5


@dataclass
class AvatarResult:
    glb: bytes
    measurements_cm: dict[str, float]  # claves de BodyMeasurements, sin weight_kg
    shape_params: list[float]  # vector opaco: identidad MHR (45) + escalas MHR (28) + factor de escala global
    pose: str  # a_pose | t_pose | relaxed
    model_version: str
    detection_quality: float  # 0..1
    weight_fit: str = "none"  # none | converged | partial
    metrics: dict[str, Any] = field(default_factory=dict)  # tiempos, nº de vértices, tamaño del GLB (sin datos personales)


def sigmas(result: AvatarResult) -> dict[str, float]:
    k = {"converged": 0.85, "partial": 1.2}.get(result.weight_fit, 1.0)
    out = {}
    for key in result.measurements_cm:
        if key in BASE_SIGMA_CM:
            s = BASE_SIGMA_CM[key] * (k if key in GIRTHS else 1.0)
            out[key] = round(s, 1)
    return out


def confidence(result: AvatarResult) -> float:
    return round(float(min(CONFIDENCE_CAP, CONFIDENCE_CAP * result.detection_quality)), 3)


def shape_hash(params: list[float], model_version: str) -> str:
    payload = json.dumps({"p": [round(float(x), 5) for x in params], "v": model_version}, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


def build_output(avatar_id: str, user_id: str, inp: dict, glb_ref: str, result: AvatarResult) -> dict:
    """`AvatarJobOutput` válido. La altura que se devuelve es la declarada (la malla se escala a ella)."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    m = dict(result.measurements_cm)
    m["height_cm"] = float(inp["height_cm"])
    if inp.get("weight_kg") is not None:
        m["weight_kg"] = float(inp["weight_kg"])
    return {
        "avatar": {
            "id": avatar_id,
            "user_id": user_id,
            "body_model": "mhr",
            "model_version": result.model_version,
            "shape": {"params": [float(x) for x in result.shape_params]},
            "measurements": m,
            "measurements_source": "photo",
            "measurements_sigma_cm": sigmas(result),
            "glb_url": glb_ref,
            "pose": result.pose,
            "shape_hash": shape_hash(result.shape_params, result.model_version),
            "confidence": confidence(result),
            "created_at": ts,
            "updated_at": ts,
        }
    }


def model_version(sam3db_variant: str, sam3db_revision: str, code_commit: str) -> str:
    """p. ej. `mhr-lod1/sam-3d-body-vith@1a2b3c4/code@b5c765a/avatar-p0.1`."""
    return f"mhr-lod1/sam-3d-body-{sam3db_variant}@{sam3db_revision[:7]}/code@{code_commit[:7]}/{PIPELINE_VERSION}"
