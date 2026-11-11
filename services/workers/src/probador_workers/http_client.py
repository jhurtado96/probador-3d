"""Descarga de entradas y subida de salidas con URLs firmadas, y envío del callback firmado.

Los errores nunca incluyen la URL (httpx la mete en sus mensajes, por eso se capturan y se reescriben).
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, Protocol
from urllib.parse import urlsplit

import httpx

from .config import Config
from .errors import ConfigError, TransferError
from .logging_setup import log_event
from .signing import canonical_body, signed_headers

log = logging.getLogger("probador.http")
_LOCAL = {"localhost", "127.0.0.1", "::1"}

# httpx/httpcore registran la URL completa (con token) de cada petición: silenciarlos siempre, también sin setup_logging().
for _n in ("httpx", "httpcore"):
    logging.getLogger(_n).setLevel(logging.WARNING)


def check_url(url: str, cfg: Config) -> None:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    local_ok = cfg.allow_insecure_localhost and host in _LOCAL
    if parts.scheme != "https" and not (parts.scheme == "http" and local_ok):
        raise TransferError("url rechazada: se exige https")
    if cfg.allowed_url_hosts and not local_ok and not any(host == h or host.endswith("." + h) for h in cfg.allowed_url_hosts):
        raise TransferError("url rechazada: host fuera de PROBADOR_ALLOWED_URL_HOSTS")


class TransferClient:
    def __init__(self, cfg: Config, client: httpx.Client | None = None):
        self.cfg = cfg
        self._client = client or httpx.Client(timeout=cfg.http_timeout_s, follow_redirects=False)

    def download(self, url: str, label: str = "input") -> bytes:
        """Descarga en memoria (nada a disco), con tope de tamaño."""
        check_url(url, self.cfg)
        buf = bytearray()
        try:
            with self._client.stream("GET", url) as r:
                if r.status_code != 200:
                    raise TransferError(f"download {label}: HTTP {r.status_code}")
                for chunk in r.iter_bytes():
                    buf += chunk
                    if len(buf) > self.cfg.max_download_bytes:
                        raise TransferError(f"download {label}: supera el tope de tamaño")
        except httpx.HTTPError as e:
            raise TransferError(f"download {label}: {type(e).__name__}") from None
        log_event(log, "downloaded", label=label, bytes=len(buf))
        return bytes(buf)

    def upload(self, url: str, data: bytes, content_type: str, label: str = "output") -> None:
        check_url(url, self.cfg)
        if len(data) > self.cfg.max_upload_bytes:
            raise TransferError(f"upload {label}: supera el tope de tamaño")
        try:
            r = self._client.put(url, content=data, headers={"content-type": content_type})
        except httpx.HTTPError as e:
            raise TransferError(f"upload {label}: {type(e).__name__}") from None
        if r.status_code >= 300:
            raise TransferError(f"upload {label}: HTTP {r.status_code}")
        log_event(log, "uploaded", label=label, bytes=len(data))


class CallbackSink(Protocol):
    def send(self, payload: dict[str, Any]) -> None: ...


class HttpCallbackSink:
    """POST del JobCallback firmado (`x-probador-timestamp` + `x-probador-signature`)."""

    def __init__(self, callback_url: str, cfg: Config, client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep):
        if not cfg.callback_secret:
            raise ConfigError("falta PROBADOR_CALLBACK_SECRET")
        check_url(callback_url, cfg)
        self._url, self._cfg, self._sleep = callback_url, cfg, sleep
        self._client = client or httpx.Client(timeout=cfg.http_timeout_s, follow_redirects=False)

    def send(self, payload: dict[str, Any]) -> None:
        body = canonical_body(payload)
        last = "?"
        for attempt in range(3):
            # Cada reintento se firma de nuevo: el timestamp tiene que estar dentro de la tolerancia del receptor.
            headers = {"content-type": "application/json", **signed_headers(body, self._cfg.callback_secret or "")}
            try:
                r = self._client.post(self._url, content=body, headers=headers)
                if r.status_code < 300:
                    return
                last = f"HTTP {r.status_code}"
                if r.status_code < 500:  # 4xx (p. ej. intento obsoleto o firma): reintentar no ayuda
                    break
            except httpx.HTTPError as e:
                last = type(e).__name__
            self._sleep(0.5 * 2**attempt)
        raise TransferError(f"callback no entregado: {last}")


class ListSink:
    """Sumidero en memoria para pruebas y `--dry-run`."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)
