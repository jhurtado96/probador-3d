from typing import Any

from .. import fake_data
from .base import JobContext, JobHandler


class ColorHandler(JobHandler):
    job_type = "color"
    default_gpu = "T4"

    def run_fake(self, ctx: JobContext) -> dict[str, Any]:
        ctx.report("fake_color", 0.5)
        return fake_data.fake_color(ctx.job_id, ctx.input)
