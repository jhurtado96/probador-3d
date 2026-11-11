"""Validación contra packages/contracts/schemas (se leen de allí, no se copian)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator, FormatChecker

from .errors import ContractError

_FORMATS = FormatChecker()

# Variante de JobDispatch y definición de salida (JobCallback) por tipo de job.
DISPATCH_DEF = {"avatar": "AvatarJobDispatch", "garment": "GarmentJobDispatch", "drape": "DrapeJobDispatch", "color": "ColorJobDispatch"}
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


def _context_paths(d: dict[str, Any]) -> list[str]:
    """Rutas del contexto de drapeado (GLB del avatar, patrón y GLB de la prenda)."""
    ctx = d.get("context") or {}
    g = ctx.get("garment", {})
    paths = [ctx.get("avatar", {}).get("glb_path"), g.get("sewing_pattern_path"), g.get("glb_path")]
    return [p for p in paths if p]


def validate_dispatch(d: Any) -> None:
    """JobDispatch (unión discriminada por `type`) + una URL de descarga por cada ruta de entrada."""
    jt = d.get("type") if isinstance(d, dict) else None
    if jt in DISPATCH_DEF:
        # Validar contra la variante del tipo da errores más precisos que el anyOf de la raíz.
        validate("job_dispatch", d, DISPATCH_DEF[jt], what="JobDispatch")
    else:
        validate("job_dispatch", d, what="JobDispatch")
    needed = _input_paths(jt, d["input"]) + _context_paths(d)
    if jt == "drape":
        g = d["context"]["garment"]
        if not (g["sewing_pattern_path"] or g["glb_path"]):
            raise ContractError("JobDispatch", ["context/garment: hace falta sewing_pattern_path o glb_path"])
    missing = [p for p in needed if p not in d["input_urls"]]
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
