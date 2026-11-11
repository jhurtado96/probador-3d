from __future__ import annotations

import argparse
import json
import sys

from .config import Config
from .errors import WorkerError
from .http_client import ListSink
from .logging_setup import setup_logging
from .runner import execute, execute_http


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="probador-workers")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="servidor local de desarrollo")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8787)
    s.add_argument("--fake", action="store_true", help="salidas FALSAS para integración (nunca en producción)")
    r = sub.add_parser("run", help="procesa un JobDispatch desde un fichero JSON")
    r.add_argument("dispatch_file")
    r.add_argument("--fake", action="store_true")
    r.add_argument("--dry-run", action="store_true", help="imprime los callbacks en vez de enviarlos")
    a = p.parse_args(argv)

    setup_logging()
    try:
        cfg = Config.from_env()
        if a.fake:
            cfg = Config(**{**cfg.__dict__, "fake": True})
            cfg.check()
        if a.cmd == "serve":
            import uvicorn

            from .server import create_app

            uvicorn.run(create_app(cfg), host=a.host, port=a.port, log_config=None, access_log=False)
            return 0
        with open(a.dispatch_file, encoding="utf-8") as f:
            dispatch = json.load(f)
        if a.dry_run:
            import httpx

            from .http_client import TransferClient

            # Sin red: las subidas del modo dry-run se aceptan en local.
            offline = TransferClient(cfg, httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b""))))
            sink = ListSink()
            execute(dispatch, cfg, sink, transfer=offline)
            json.dump(sink.sent, sys.stdout, indent=2, ensure_ascii=False)
            print()
        else:
            execute_http(dispatch, cfg)
        return 0
    except WorkerError as e:
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
