"""Configuración desde variables de entorno. Los secretos solo se leen de aquí, nunca se loguean."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .errors import ConfigError

JOB_TYPES = ("avatar", "garment", "drape", "color")
DEFAULT_GPU = {"avatar": "A10G", "garment": "T4", "drape": "A10G", "color": "T4"}
# Plazo de un intento, igual que private.job_timeout de la API (B4): Modal corta la función a la vez que la API da el
# intento por vencido, así un intento viejo no sigue corriendo mientras se despacha el siguiente.
JOB_TIMEOUT_S = {"avatar": 600, "garment": 600, "drape": 600, "color": 300}


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    env: str = "development"
    fake: bool = False
    callback_secret: str | None = field(default=None, repr=False)
    dispatch_secret: str | None = field(default=None, repr=False)
    schemas_dir: Path | None = None
    allowed_url_hosts: tuple[str, ...] = ()
    allow_insecure_localhost: bool = True
    max_download_bytes: int = 25 * 1024 * 1024
    max_upload_bytes: int = 64 * 1024 * 1024
    http_timeout_s: float = 30.0
    modal_region: str = "eu"
    gpu: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_GPU))

    @classmethod
    def from_env(cls) -> "Config":
        env = os.environ.get("PROBADOR_ENV", "development")
        sd = os.environ.get("PROBADOR_SCHEMAS_DIR")
        hosts = tuple(h.strip().lower() for h in os.environ.get("PROBADOR_ALLOWED_URL_HOSTS", "").split(",") if h.strip())
        gpu = {t: os.environ.get(f"PROBADOR_GPU_{t.upper()}", d) for t, d in DEFAULT_GPU.items()}
        cfg = cls(
            env=env,
            fake=_bool("PROBADOR_FAKE", False),
            callback_secret=os.environ.get("PROBADOR_CALLBACK_SECRET") or None,
            dispatch_secret=os.environ.get("PROBADOR_DISPATCH_SECRET") or None,
            schemas_dir=Path(sd) if sd else None,
            allowed_url_hosts=hosts,
            allow_insecure_localhost=_bool("PROBADOR_ALLOW_INSECURE_LOCALHOST", env != "production"),
            max_download_bytes=int(os.environ.get("PROBADOR_MAX_DOWNLOAD_BYTES", 25 * 1024 * 1024)),
            max_upload_bytes=int(os.environ.get("PROBADOR_MAX_UPLOAD_BYTES", 64 * 1024 * 1024)),
            http_timeout_s=float(os.environ.get("PROBADOR_HTTP_TIMEOUT_S", 30)),
            modal_region=os.environ.get("PROBADOR_MODAL_REGION", "eu"),
            gpu=gpu,
        )
        cfg.check()
        return cfg

    def check(self) -> None:
        if self.env == "production":
            if self.fake:
                raise ConfigError("PROBADOR_FAKE no se admite con PROBADOR_ENV=production")
            if not self.dispatch_secret or not self.callback_secret:
                raise ConfigError("En producción hacen falta PROBADOR_DISPATCH_SECRET y PROBADOR_CALLBACK_SECRET")
            if self.allow_insecure_localhost:
                raise ConfigError("PROBADOR_ALLOW_INSECURE_LOCALHOST no se admite en producción")
            if not self.allowed_url_hosts:
                raise ConfigError("En producción hace falta PROBADOR_ALLOWED_URL_HOSTS (host del proyecto de Supabase)")
