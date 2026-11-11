"""Interfaz común de los manejadores por tipo de job."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, ClassVar

from ..config import Config
from ..errors import JobFailure, NotImplementedJob
from ..http_client import TransferClient


@dataclass
class JobContext:
    dispatch: dict[str, Any]
    cfg: Config
    transfer: TransferClient
    fake: bool
    report: Callable[[str, float], None]  # report(stage, progress 0..1) -> callback `running`

    @property
    def job_id(self) -> str:
        return self.dispatch["job_id"]

    @property
    def input(self) -> dict[str, Any]:
        return self.dispatch["input"]

    @property
    def user_id(self) -> str | None:
        """Dueño del job (`JobDispatch.user_id`); `None` en jobs de catálogo."""
        return self.dispatch["user_id"]

    def require_user_id(self) -> str:
        if self.user_id is None:
            raise JobFailure("invalid_input", f"un job '{self.dispatch['type']}' necesita user_id", retryable=False)
        return self.user_id

    def upload_target(self, name: str) -> dict[str, Any]:
        for u in self.dispatch["output_uploads"]:
            if u["name"] == name:
                return u
        raise JobFailure("invalid_input", f"output_uploads sin artefacto '{name}'", retryable=False)

    def upload(self, name: str, data: bytes, content_type: str) -> str:
        """Sube un artefacto y devuelve su referencia `storage://<path>` para el callback."""
        t = self.upload_target(name)
        self.transfer.upload(t["upload_url"], data, content_type, label=name)
        return f"storage://{t['path']}"

    def download_input(self, path: str) -> bytes:
        return self.transfer.download(self.dispatch["input_urls"][path], label="input")


class JobHandler(ABC):
    job_type: ClassVar[str]
    default_gpu: ClassVar[str]

    def run(self, ctx: JobContext) -> dict[str, Any]:
        """Devuelve el `output` del JobCallback. Sin `--fake` el esqueleto falla con not_implemented."""
        return self.run_fake(ctx) if ctx.fake else self.run_real(ctx)

    def run_real(self, ctx: JobContext) -> dict[str, Any]:
        raise NotImplementedJob(f"not_implemented: el pipeline real de '{self.job_type}' aún no existe (esqueleto sin ML)")

    @abstractmethod
    def run_fake(self, ctx: JobContext) -> dict[str, Any]:
        """Salida válida según el esquema, marcada como falsa. No descarga entradas personales."""
