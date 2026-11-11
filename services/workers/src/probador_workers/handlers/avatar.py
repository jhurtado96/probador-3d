import uuid
from typing import Any

from .. import fake_data
from .base import JobContext, JobHandler


class AvatarHandler(JobHandler):
    job_type = "avatar"
    default_gpu = "A10G"

    def run_fake(self, ctx: JobContext) -> dict[str, Any]:
        user_id = ctx.require_user_id()
        ctx.report("fake_avatar", 0.5)
        glb = ctx.upload("glb", fake_data.minimal_glb(), "model/gltf-binary")
        avatar_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fake-avatar:{ctx.job_id}"))
        return fake_data.fake_avatar(avatar_id, user_id, ctx.input, glb)
