from __future__ import annotations

from .avatar import AvatarHandler
from .base import JobContext, JobHandler
from .color import ColorHandler
from .drape import DrapeHandler
from .garment import GarmentHandler

HANDLERS: dict[str, JobHandler] = {h.job_type: h for h in (AvatarHandler(), GarmentHandler(), DrapeHandler(), ColorHandler())}


def get_handler(job_type: str) -> JobHandler:
    return HANDLERS[job_type]


__all__ = ["HANDLERS", "get_handler", "JobContext", "JobHandler"]
