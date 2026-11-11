"""Firma HMAC-SHA256 del callback (cabecera `x-probador-signature`).

Formato elegido (el contrato solo dice "HMAC-SHA256"): `sha256=<hex>` sobre los bytes EXACTOS del cuerpo HTTP.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

SIGNATURE_HEADER = "x-probador-signature"
PREFIX = "sha256="


def canonical_body(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False, sort_keys=True).encode("utf-8")


def sign(body: bytes, secret: str) -> str:
    return PREFIX + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def verify(body: bytes, signature: str | None, secret: str) -> bool:
    if not signature or not secret:
        return False
    return hmac.compare_digest(sign(body, secret), signature.strip())
