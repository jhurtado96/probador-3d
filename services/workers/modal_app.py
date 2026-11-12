"""Punto de entrada Modal. Despliegue: `modal deploy modal_app.py` (ver README).

Diseño (A3, revisión de la fase 0): un endpoint HTTP ligero (`dispatch`, CPU, región UE) verifica la firma del
JobDispatchNotice, que solo lleva job_id, tipo, intento y la URL de job-dispatch, y lo encola con `.spawn()` en la
función GPU del tipo de job. Lo que Modal guarda como entrada de la llamada es, por tanto, ese aviso sin datos
personales. Ya en el contenedor, la función pide el JobDispatch completo (URLs firmadas a la foto, medidas, user_id)
directamente a la API, lo procesa, devuelve el resultado por callback firmado y retorna `None`, de modo que Modal no
guarda ningún resultado. Timeout por tipo igual al plazo de la API (B4).
La región UE y la GPU por tipo salen de variables de entorno LEÍDAS EN EL DESPLIEGUE (ver README).
No hay credenciales de base de datos: solo los secretos de firma HMAC (Modal Secret `probador-workers`).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import modal
from fastapi import HTTPException, Request

from probador_workers.config import DEFAULT_GPU, JOB_TIMEOUT_S, JOB_TYPES
from probador_workers.schemas import schemas_dir

REGION = os.environ.get("PROBADOR_MODAL_REGION", "eu")  # región amplia UE (EEE), multiplicador 1,15x; ver docs.modal.com region-selection
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
    @app.function(name=f"run_{job_type}", gpu=_gpu(job_type), region=REGION, timeout=JOB_TIMEOUT_S[job_type], retries=0)
    def run(notice: dict) -> None:
        from probador_workers.config import Config
        from probador_workers.logging_setup import setup_logging
        from probador_workers.runner import execute_notice

        setup_logging()
        execute_notice(notice, Config.from_env())
        return None  # nada que Modal pueda guardar como resultado

    return run


RUNNERS = {t: _make_gpu_function(t) for t in JOB_TYPES}


@app.function(name="dispatch", region=REGION)
@modal.fastapi_endpoint(method="POST")
async def dispatch(request: Request) -> dict:
    from probador_workers.config import Config
    from probador_workers.errors import ContractError
    from probador_workers.schemas import validate_notice
    from probador_workers.signing import verify_request

    cfg = Config.from_env()
    raw = await request.body()
    if not verify_request(raw, request.headers, cfg.dispatch_secret or ""):
        raise HTTPException(401, "invalid signature")
    try:
        data = json.loads(raw)
        validate_notice(data)
    except (ValueError, ContractError) as e:
        raise HTTPException(422, e.problems if isinstance(e, ContractError) else ["invalid json"])
    # Solo el aviso (ids) entra en la cola de Modal.
    RUNNERS[data["type"]].spawn(data)
    return {"accepted": True, "job_id": data["job_id"], "attempt": data["attempt"]}
