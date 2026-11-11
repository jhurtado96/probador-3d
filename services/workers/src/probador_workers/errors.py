"""Errores del worker. Ningún mensaje debe contener URLs firmadas ni datos personales."""

from __future__ import annotations


class WorkerError(Exception):
    """Base."""


class ConfigError(WorkerError):
    pass


class ContractError(WorkerError):
    """Datos que no cumplen un JSON Schema de packages/contracts. `problems` no incluye valores."""

    def __init__(self, what: str, problems: list[str]):
        self.what = what
        self.problems = problems
        super().__init__(f"{what} invalid: " + "; ".join(problems[:10]))


class TransferError(WorkerError):
    """Fallo al descargar/subir. Solo operación y causa, nunca la URL."""


class SignatureError(WorkerError):
    pass


class NotImplementedJob(WorkerError):
    """El manejador real aún no existe (esqueleto sin ML)."""


class JobFailure(WorkerError):
    """Fallo de negocio con un código de JobErrorCode del contrato."""

    def __init__(self, code: str, message: str, retryable: bool = False):
        self.code = code
        self.retryable = retryable
        super().__init__(message)
