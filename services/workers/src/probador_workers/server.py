"""Servidor local equivalente al endpoint de Modal: POST /dispatch devuelve 202 y procesa en segundo plano."""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request

from .config import Config
from .errors import ContractError, WorkerError
from .http_client import CallbackSink, HttpCallbackSink, TransferClient
from .logging_setup import log_event
from .runner import execute
from .schemas import validate_dispatch
from .signing import verify_request

log = logging.getLogger("probador.server")


def create_app(
    cfg: Config,
    sink_factory: Callable[[dict[str, Any]], CallbackSink] | None = None,
    transfer: TransferClient | None = None,
) -> FastAPI:
    cfg.check()
    app = FastAPI(title="probador-workers (local)")
    sink_factory = sink_factory or (lambda d: HttpCallbackSink(d["callback_url"], cfg))

    def run(dispatch: dict[str, Any]) -> None:
        try:
            execute(dispatch, cfg, sink_factory(dispatch), transfer=transfer)
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
            validate_dispatch(data)
        except (ValueError, ContractError) as e:
            detail = e.problems if isinstance(e, ContractError) else ["invalid json"]
            raise HTTPException(422, detail)
        background.add_task(run, data)
        return {"accepted": True, "job_id": data["job_id"], "attempt": data["attempt"]}

    return app
