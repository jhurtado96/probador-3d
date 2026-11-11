from typing import Any

from .. import fake_data
from .base import JobContext, JobHandler


class GarmentHandler(JobHandler):
    job_type = "garment"
    default_gpu = "T4"

    def run_fake(self, ctx: JobContext) -> dict[str, Any]:
        ctx.report("fake_garment", 0.5)
        glb = ctx.upload("glb", fake_data.minimal_glb(), "model/gltf-binary")
        image = ctx.upload("image", fake_data.minimal_png(), "image/png")
        return fake_data.fake_garment(ctx.input, glb, image)
