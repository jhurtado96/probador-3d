"""Servidor local equivalente al endpoint de Modal.

POST /dispatch recibe un JobDispatchNotice firmado (solo ids, A3), responde 202 y en segundo plano pide el JobDispatch
completo a `dispatch_url` y lo procesa.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request

from .config import Config
from .errors import ContractError, WorkerError
from .http_client import CallbackSink, HttpCallbackSink, TransferClient, fetch_dispatch
from .logging_setup import log_event
from .runner import execute_notice
from .schemas import validate_notice
from .signing import verify_request

log = logging.getLogger("probador.server")


def create_app(
    cfg: Config,
    sink_factory: Callable[[dict[str, Any]], CallbackSink] | None = None,
    transfer: TransferClient | None = None,
    fetch: Callable[[dict[str, Any], Config], dict[str, Any]] = fetch_dispatch,
) -> FastAPI:
    cfg.check()
    app = FastAPI(title="probador-workers (local)")
    sink_factory = sink_factory or (lambda d: HttpCallbackSink(d["callback_url"], cfg))

    def run(notice: dict[str, Any]) -> None:
        try:
            execute_notice(notice, cfg, fetch=fetch, sink_factory=sink_factory, transfer=transfer)
        except WorkerError as e:
            log_event(log, "job_aborted", level=logging.ERROR, error_type=type(e).__name__)

    @app.get("/healthz")
    def healthz() -> dict[str, Any]:
        return {"ok": True, "fake": cfg.fake, "env": cfg.env}

    @app.post("/dispatch", status_code=202)
    async def dispatch(request: Request, background: BackgroundTasks) -> dict[str, Any]:
        raw = await request.body()
        if cfg.dispatch_secret and not verify_request(raw, request.headers, cfg.dispatch_secret):
            raise HTTPException(401, "invalid signature")
        try:
            data = json.loads(raw)
            validate_notice(data)
        except (ValueError, ContractError) as e:
            detail = e.problems if isinstance(e, ContractError) else ["invalid json"]
            raise HTTPException(422, detail)
        background.add_task(run, data)
        return {"accepted": True, "job_id": data["job_id"], "attempt": data["attempt"]}

    return app
