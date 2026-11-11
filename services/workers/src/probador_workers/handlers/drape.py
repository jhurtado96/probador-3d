from typing import Any

from .. import fake_data
from .base import JobContext, JobHandler


class DrapeHandler(JobHandler):
    job_type = "drape"
    default_gpu = "A10G"

    def run_fake(self, ctx: JobContext) -> dict[str, Any]:
        ctx.report("fake_drape", 0.5)
        glb = ctx.upload("glb", fake_data.minimal_glb(), "model/gltf-binary")
        # La clave de caché la calcula la API (context.cache_key) y se devuelve tal cual.
        return fake_data.fake_drape(ctx.job_id, ctx.user_id, ctx.input, ctx.dispatch["context"]["cache_key"], glb)
