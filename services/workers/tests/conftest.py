import copy
import json
import uuid
from pathlib import Path

import pytest

from probador_workers.config import Config
from probador_workers.schemas import schemas_dir

EXAMPLES = schemas_dir().parent / "examples"
SECRET = "test-callback-secret"
TOKEN = "SECRET-TOKEN-123"


def _url(path: str) -> str:
    return f"https://example.supabase.co/storage/v1/object/sign/{path}?token={TOKEN}"


USER_ID = "5e2a9d7c-1b34-4c8a-8f10-7d6f3a2b9c01"


def make_dispatch(job_type: str, **over):
    job_id = str(uuid.uuid4())
    cid = str(uuid.uuid4())
    extra = {}

    def out(name, path, content_type):
        return {"name": name, "path": path, "upload_url": _url("up/" + name), "content_type": content_type}

    if job_type == "avatar":
        inp = {"photo_path": "raw-uploads/u/photo.jpg", "height_cm": 172, "consent_id": cid}
        urls = {"raw-uploads/u/photo.jpg": _url("raw-uploads/u/photo.jpg")}
        outs = [out("glb", f"assets/u/avatars/{job_id}-a1.glb", "model/gltf-binary")]
    elif job_type == "garment":
        inp = {"garment_id": str(uuid.uuid4()), "image_paths": ["raw-uploads/u/g1.jpg"], "category_hint": "shirt", "size_label": "M"}
        urls = {"raw-uploads/u/g1.jpg": _url("raw-uploads/u/g1.jpg")}
        outs = [
            out("glb", "assets/u/garments/g/j-a1.glb", "model/gltf-binary"),
            out("image", "assets/u/garments/g/j-a1-cutout.png", "image/png"),
            out("sewing_pattern", "assets/u/garments/g/j-a1-pattern.json", "application/json"),
        ]
    elif job_type == "drape":
        ex = example("JobDispatch.drape.json")
        inp, urls, extra = ex["input"], ex["input_urls"], {"context": ex["context"]}
        outs = [out("glb", "assets/u/drapes/d-a1.glb", "model/gltf-binary")]
    else:
        inp = {"selfie_path": "raw-uploads/u/selfie.jpg", "white_reference": "paper", "consent_id": cid}
        urls = {"raw-uploads/u/selfie.jpg": _url("raw-uploads/u/selfie.jpg")}
        outs = []
    d = {
        "job_id": job_id, "user_id": USER_ID, "type": job_type, "input": inp, **extra, "input_urls": urls,
        "output_uploads": outs, "callback_url": "https://example.supabase.co/functions/v1/job-callback", "attempt": 1,
        "contracts_version": "0.2.0",
    }
    d.update(over)
    return copy.deepcopy(d)


@pytest.fixture
def cfg():
    return Config(callback_secret=SECRET, dispatch_secret="dispatch-secret")


@pytest.fixture(params=["avatar", "garment", "drape", "color"])
def job_type(request):
    return request.param


def example(name: str):
    return json.loads((EXAMPLES / name).read_text())
