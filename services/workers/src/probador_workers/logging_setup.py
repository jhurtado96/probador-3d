"""Registro estructurado JSON sin datos personales.

Reglas: solo campos escalares con nombre permitido; se descartan campos cuyo nombre sugiera datos sensibles;
cualquier URL o ruta storage:// en un valor se sustituye; las excepciones se registran solo con su clase.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time

_URL = re.compile(r"(?:https?|storage)://[^\s\"'<>]+", re.I)
_SECRET_HEADER = re.compile(r"(x-probador-signature\s*[:=]\s*)\S+", re.I)
_FORBIDDEN_KEYS = ("url", "path", "photo", "selfie", "image", "token", "signature", "secret", "body", "content", "input")


def redact(text: str) -> str:
    return _SECRET_HEADER.sub(r"\1<redacted>", _URL.sub("<redacted-url>", text))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + "Z",
            "level": record.levelname,
            "logger": record.name,
            "event": redact(record.getMessage()),
        }
        for k, v in getattr(record, "ctx", {}).items():
            out[k] = v
        if record.exc_info and record.exc_info[0] is not None:
            out["exc_type"] = record.exc_info[0].__name__  # sin mensaje ni traza: podrían contener URLs
        return json.dumps(out, ensure_ascii=False)


def _clean(fields: dict) -> dict:
    clean = {}
    for k, v in fields.items():
        if any(f in k.lower() for f in _FORBIDDEN_KEYS):
            continue
        if isinstance(v, str):
            v = redact(v)
        elif not isinstance(v, (int, float, bool, type(None))):
            v = redact(str(v))
        clean[k] = v
    return clean


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **fields) -> None:
    """Ej.: log_event(log, "job_started", job_id=..., job_type="avatar", attempt=1)."""
    logger.log(level, event, extra={"ctx": _clean(fields)})


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    root.addHandler(h)
    root.setLevel(level)
    # httpx/httpcore registran la URL completa de cada petición: silenciar.
    for noisy in ("httpx", "httpcore", "hpack", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
