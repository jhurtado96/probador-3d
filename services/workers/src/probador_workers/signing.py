"""Firma HMAC-SHA256 entre API y workers (packages/contracts, «Firma de peticiones entre API y workers»).

Vale igual para el dispatch entrante (secreto PROBADOR_DISPATCH_SECRET) y para el callback saliente
(PROBADOR_CALLBACK_SECRET):

    x-probador-timestamp: <segundos Unix>
    x-probador-signature: sha256=<hex(HMAC-SHA256(secreto, "<timestamp>." + bytes EXACTOS del cuerpo))>

Se rechaza si falta algo, si la firma no coincide o si el timestamp se aleja más de TOLERANCE_SECONDS del reloj local.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, Mapping

SIGNATURE_HEADER = "x-probador-signature"
TIMESTAMP_HEADER = "x-probador-timestamp"
PREFIX = "sha256="
TOLERANCE_SECONDS = 300


def canonical_body(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False, sort_keys=True).encode("utf-8")


def sign(body: bytes, secret: str, timestamp: int | str) -> str:
    msg = str(timestamp).encode("ascii") + b"." + body
    return PREFIX + hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def signed_headers(body: bytes, secret: str, now: float | None = None) -> dict[str, str]:
    """Cabeceras de una petición firmada ahora."""
    ts = str(int(time.time() if now is None else now))
    return {TIMESTAMP_HEADER: ts, SIGNATURE_HEADER: sign(body, secret, ts)}


def verify(
    body: bytes,
    signature: str | None,
    timestamp: str | None,
    secret: str,
    now: float | None = None,
    tolerance: int = TOLERANCE_SECONDS,
) -> bool:
    if not signature or not timestamp or not secret:
        return False
    ts = timestamp.strip()
    if not ts.isascii() or not ts.isdigit() or len(ts) > 12:
        return False
    if abs((time.time() if now is None else now) - int(ts)) > tolerance:
        return False
    return hmac.compare_digest(sign(body, secret, ts), signature.strip())


def verify_request(body: bytes, headers: Mapping[str, str], secret: str, now: float | None = None) -> bool:
    return verify(body, headers.get(SIGNATURE_HEADER), headers.get(TIMESTAMP_HEADER), secret, now=now)
