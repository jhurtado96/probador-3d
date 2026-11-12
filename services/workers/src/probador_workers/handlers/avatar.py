import uuid
from typing import Any

from .. import fake_data
from ..logging_setup import log_event
from .base import JobContext, JobHandler


class AvatarHandler(JobHandler):
    job_type = "avatar"
    default_gpu = "L4"

    def run_real(self, ctx: JobContext) -> dict[str, Any]:
        """Foto (URL firmada) -> SAM 3D Body -> MHR -> medidas + GLB subido -> `AvatarJobOutput`.

        La foto se descarga a memoria y se entrega al pipeline, que la descarta tras estimar la forma; nunca se escribe
        en disco ni en los logs. Los logs solo llevan tiempos y tamaños, no medidas (son datos personales).
        """
        import logging

        from ..avatar.output import build_output
        from ..avatar.pipeline import AvatarModels, run_pipeline

        user_id = ctx.require_user_id()
        inp = ctx.input
        ctx.report("loading_models", 0.02)
        models = AvatarModels.get()  # antes de descargar la foto: si faltan pesos, la foto ni se toca
        ctx.report("downloading_photo", 0.05)
        photo = bytearray(ctx.download_input(inp["photo_path"]))
        result = run_pipeline(photo, float(inp["height_cm"]), inp.get("weight_kg"), models=models, report=ctx.report)
        del photo
        ctx.report("uploading", 0.9)
        glb_ref = ctx.upload("glb", result.glb, "model/gltf-binary")
        avatar_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"avatar:{ctx.job_id}"))
        metrics = {k: v for k, v in result.metrics.items() if k.endswith("_s") or k in {
            "cold_start", "vertices_glb", "triangles_glb", "glb_bytes", "skinned", "pose", "weight_fit"}}
        log_event(logging.getLogger("probador.avatar"), "avatar_built", job_id=ctx.job_id, **metrics)
        return build_output(avatar_id, user_id, inp, glb_ref, result)

    def run_fake(self, ctx: JobContext) -> dict[str, Any]:
        user_id = ctx.require_user_id()
        ctx.report("fake_avatar", 0.5)
        glb = ctx.upload("glb", fake_data.minimal_glb(), "model/gltf-binary")
        avatar_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fake-avatar:{ctx.job_id}"))
        return fake_data.fake_avatar(avatar_id, user_id, ctx.input, glb)
