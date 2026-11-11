"""Ejecución de un job: validar dispatch -> manejador -> validar salida -> callback firmado."""

from __future__ import annotations

import logging
import time
from typing import Any, Callable

from . import __version__
from .config import Config
from .errors import ContractError, JobFailure, NotImplementedJob, TransferError
from .handlers import JobContext, get_handler
from .http_client import CallbackSink, HttpCallbackSink, TransferClient, fetch_dispatch
from .logging_setup import log_event, redact
from .schemas import validate_callback, validate_dispatch, validate_notice

log = logging.getLogger("probador.runner")


def worker_version(job_type: str, fake: bool) -> str:
    return f"{job_type}-{'fake-' if fake else ''}{__version__}"


def execute(
    dispatch: dict[str, Any],
    cfg: Config,
    sink: CallbackSink,
    transfer: TransferClient | None = None,
    fake: bool | None = None,
) -> dict[str, Any]:
    """Procesa un JobDispatch y envía los callbacks. Devuelve el callback final."""
    fake = cfg.fake if fake is None else fake
    transfer = transfer or TransferClient(cfg)
    try:
        validate_dispatch(dispatch)
    except ContractError as e:
        log_event(log, "dispatch_invalid", level=logging.WARNING, problems=len(e.problems))
        raise

    job_id, jt, attempt = dispatch["job_id"], dispatch["type"], dispatch["attempt"]
    wv = worker_version(jt, fake)
    base = {"job_id": job_id, "attempt": attempt, "worker_version": wv}
    if fake:
        base["fake"] = True  # marca estándar del contrato (JobCallback.fake)
    t0 = time.monotonic()
    ctx_log = {"job_id": job_id, "job_type": jt, "attempt": attempt, "fake": fake}

    def send(cb: dict[str, Any]) -> None:
        validate_callback(cb, jt)
        sink.send(cb)

    def report(stage: str, progress: float) -> None:
        send({**base, "status": "running", "progress": progress, "stage": stage})

    log_event(log, "job_started", **ctx_log)
    try:
        report("started", 0.0)
        ctx = JobContext(dispatch=dispatch, cfg=cfg, transfer=transfer, fake=fake, report=report)
        output = get_handler(jt).run(ctx)
        final = {**base, "status": "succeeded", "progress": 1, "output": output}
        send(final)
        log_event(log, "job_succeeded", duration_ms=int((time.monotonic() - t0) * 1000), **ctx_log)
        return final
    except NotImplementedJob as e:
        return _fail(send, base, "not_implemented", str(e), False, ctx_log)
    except JobFailure as e:
        return _fail(send, base, e.code, redact(str(e)), e.retryable, ctx_log)
    except TransferError as e:
        return _fail(send, base, "internal", redact(str(e)), True, ctx_log)
    except ContractError as e:  # nuestra propia salida no cumple el contrato: bug del worker
        return _fail(send, base, "internal", f"output inválido: {len(e.problems)} problema(s)", False, ctx_log)
    except Exception as e:  # noqa: BLE001 - no filtrar str(e): puede traer URLs
        return _fail(send, base, "internal", f"error inesperado: {type(e).__name__}", False, ctx_log)


def _fail(send: Callable, base: dict, code: str, message: str, retryable: bool, ctx_log: dict) -> dict[str, Any]:
    cb = {**base, "status": "failed", "error": {"code": code, "message": message, "retryable": retryable}}
    send(cb)
    log_event(log, "job_failed", level=logging.WARNING, error_code=code, retryable=retryable, **ctx_log)
    return cb


def execute_http(dispatch: dict[str, Any], cfg: Config, fake: bool | None = None) -> dict[str, Any]:
    """Variante de producción: callback real a `callback_url`."""
    sink = HttpCallbackSink(dispatch["callback_url"], cfg)
    return execute(dispatch, cfg, sink, fake=fake)


def execute_notice(
    notice: dict[str, Any],
    cfg: Config,
    fetch: Callable[[dict[str, Any], Config], dict[str, Any]] = fetch_dispatch,
    sink_factory: Callable[[dict[str, Any]], CallbackSink] | None = None,
    transfer: TransferClient | None = None,
    fake: bool | None = None,
) -> None:
    """A3: aviso de despacho -> pide el JobDispatch a la API -> lo procesa.

    No devuelve nada a propósito: en Modal, lo que devuelve una función lanzada con `.spawn()` se guarda como resultado
    de la llamada en el plano de control del proveedor. El resultado viaja solo por el callback firmado.
    """
    validate_notice(notice)
    ctx_log = {"job_id": notice["job_id"], "job_type": notice["type"], "attempt": notice["attempt"]}
    dispatch = fetch(notice, cfg)
    if (dispatch.get("job_id"), dispatch.get("attempt"), dispatch.get("type")) != (
        notice["job_id"],
        notice["attempt"],
        notice["type"],
    ):
        log_event(log, "dispatch_mismatch", level=logging.WARNING, **ctx_log)
        raise ContractError("JobDispatch", ["job_id/attempt/type no coinciden con el aviso"])
    sink = sink_factory(dispatch) if sink_factory else HttpCallbackSink(dispatch["callback_url"], cfg)
    execute(dispatch, cfg, sink, transfer=transfer, fake=fake)
    return None
