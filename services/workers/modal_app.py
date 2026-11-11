"""Punto de entrada Modal. Despliegue: `modal deploy modal_app.py` (ver README).

Diseño: un endpoint HTTP ligero (`dispatch`, CPU, región UE) valida y firma-verifica el JobDispatch, lo encola con
`.spawn()` en la función GPU del tipo de job y devuelve 202 enseguida; el resultado vuelve por callback firmado.
La región UE y la GPU por tipo salen de variables de entorno LEÍDAS EN EL DESPLIEGUE (ver README).
No hay credenciales de base de datos: solo los secretos de firma HMAC (Modal Secret `probador-workers`).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import modal
from fastapi import HTTPException, Request

from probador_workers.config import DEFAULT_GPU, JOB_TYPES
from probador_workers.schemas import schemas_dir

REGION = os.environ.get("PROBADOR_MODAL_REGION", "eu-west")  # (verificar) nombre de región/plan Modal para UE
FAKE = os.environ.get("PROBADOR_FAKE", "0")
ENV = os.environ.get("PROBADOR_ENV", "production")
GPU = {t: os.environ.get(f"PROBADOR_GPU_{t.upper()}", DEFAULT_GPU[t]) for t in JOB_TYPES}
REMOTE_SCHEMAS = "/contracts/schemas"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("httpx>=0.27", "jsonschema[format-nongpl]>=4.21", "fastapi>=0.110")
    # Las dependencias de ML de cada worker se añadirán aquí (una imagen por worker, ver docs/architecture.md).
    .env({"PROBADOR_ENV": ENV, "PROBADOR_FAKE": FAKE, "PROBADOR_SCHEMAS_DIR": REMOTE_SCHEMAS, "PROBADOR_ALLOW_INSECURE_LOCALHOST": "0"})
    .add_local_dir(str(schemas_dir()), remote_path=REMOTE_SCHEMAS)
    .add_local_python_source("probador_workers")
)
secrets = [modal.Secret.from_name("probador-workers")]  # PROBADOR_DISPATCH_SECRET, PROBADOR_CALLBACK_SECRET
app = modal.App("probador-workers", image=image, secrets=secrets)


def _gpu(job_type: str):
    g = GPU[job_type]
    return None if g.lower() in {"", "none", "cpu"} else g


def _make_gpu_function(job_type: str):
    @app.function(name=f"run_{job_type}", gpu=_gpu(job_type), region=REGION, timeout=15 * 60, retries=0)
    def run(dispatch: dict) -> dict:
        from probador_workers.config import Config
        from probador_workers.logging_setup import setup_logging
        from probador_workers.runner import execute_http

        setup_logging()
        return execute_http(dispatch, Config.from_env())

    return run


RUNNERS = {t: _make_gpu_function(t) for t in JOB_TYPES}


@app.function(name="dispatch", region=REGION)
@modal.fastapi_endpoint(method="POST")
async def dispatch(request: Request) -> dict:
    from probador_workers.config import Config
    from probador_workers.errors import ContractError
    from probador_workers.schemas import validate_dispatch
    from probador_workers.signing import SIGNATURE_HEADER, verify

    cfg = Config.from_env()
    raw = await request.body()
    if not verify(raw, request.headers.get(SIGNATURE_HEADER), cfg.dispatch_secret or ""):
        raise HTTPException(401, "invalid signature")
    try:
        data = json.loads(raw)
        validate_dispatch(data)
    except (ValueError, ContractError) as e:
        raise HTTPException(422, e.problems if isinstance(e, ContractError) else ["invalid json"])
    RUNNERS[data["type"]].spawn(data)
    return {"accepted": True, "job_id": data["job_id"], "attempt": data["attempt"]}
