"""Validación contra packages/contracts/schemas (se leen de allí, no se copian)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator, FormatChecker

from .errors import ContractError

_FORMATS = FormatChecker()

# Definición de entrada (JobDispatch) y de salida (JobCallback) por tipo de job.
INPUT_DEF = {"avatar": "AvatarJobInput", "garment": "GarmentJobInput", "drape": "DrapeJobInput", "color": "ColorJobInput"}
OUTPUT_DEF = {"avatar": "AvatarJobOutput", "garment": "GarmentJobOutput", "drape": "DrapeJobOutput", "color": "ColorJobOutput"}


def schemas_dir() -> Path:
    env = os.environ.get("PROBADOR_SCHEMAS_DIR")
    if env:
        return Path(env)
    # services/workers/src/probador_workers/schemas.py -> raíz del monorepo = parents[4]
    return Path(__file__).resolve().parents[4] / "packages" / "contracts" / "schemas"


@lru_cache(maxsize=None)
def load_schema(name: str) -> dict[str, Any]:
    import json

    path = schemas_dir() / f"{name}.schema.json"
    if not path.is_file():
        raise FileNotFoundError(f"schema no encontrado: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def _validator(name: str, definition: str | None) -> Draft7Validator:
    schema = load_schema(name)
    if definition:
        schema = {"$schema": schema["$schema"], "$ref": f"#/definitions/{definition}", "definitions": schema["definitions"]}
    return Draft7Validator(schema, format_checker=_FORMATS)


def problems(name: str, instance: Any, definition: str | None = None) -> list[str]:
    """Lista de problemas SIN valores (los valores pueden ser URLs firmadas o datos personales)."""
    out = []
    for e in sorted(_validator(name, definition).iter_errors(instance), key=lambda e: list(map(str, e.absolute_path))):
        loc = "/".join(str(p) for p in e.absolute_path) or "<root>"
        out.append(f"{loc}: {e.validator}")
    return out


def validate(name: str, instance: Any, definition: str | None = None, what: str | None = None) -> None:
    p = problems(name, instance, definition)
    if p:
        raise ContractError(what or name, p)


def _input_paths(job_type: str, inp: dict[str, Any]) -> list[str]:
    if job_type == "avatar":
        return [inp["photo_path"]]
    if job_type == "color":
        return [inp["selfie_path"]]
    if job_type == "garment":
        return list(inp["image_paths"])
    return []


def validate_dispatch(d: Any) -> None:
    """JobDispatch + entrada específica del tipo (el anyOf del schema es demasiado laxo) + URLs de entrada."""
    validate("job_dispatch", d, what="JobDispatch")
    jt = d["type"]
    validate("job_dispatch", d["input"], INPUT_DEF[jt], what=f"{jt} input")
    missing = [p for p in _input_paths(jt, d["input"]) if p not in d["input_urls"]]
    if missing:
        raise ContractError("JobDispatch", [f"input_urls: falta URL para {len(missing)} ruta(s) de entrada"])


def validate_callback(cb: Any, job_type: str) -> None:
    validate("job_callback", cb, what="JobCallback")
    if cb["status"] == "succeeded":
        if "output" not in cb:
            raise ContractError("JobCallback", ["output: requerido con status=succeeded"])
        validate("job_callback", cb["output"], OUTPUT_DEF[job_type], what=f"{job_type} output")
    if cb["status"] == "failed" and "error" not in cb:
        raise ContractError("JobCallback", ["error: requerido con status=failed"])
