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


def make_dispatch(job_type: str, **over):
    job_id = str(uuid.uuid4())
    cid = str(uuid.uuid4())
    if job_type == "avatar":
        inp = {"photo_path": "raw-uploads/u/photo.jpg", "height_cm": 172, "consent_id": cid}
        urls = {"raw-uploads/u/photo.jpg": _url("raw-uploads/u/photo.jpg")}
        outs = [{"name": "glb", "path": f"avatars/u/{job_id}.glb", "upload_url": _url("up/glb")}]
    elif job_type == "garment":
        inp = {"garment_id": str(uuid.uuid4()), "image_paths": ["raw-uploads/u/g1.jpg"], "category_hint": "shirt", "size_label": "M"}
        urls = {"raw-uploads/u/g1.jpg": _url("raw-uploads/u/g1.jpg")}
        outs = [
            {"name": "glb", "path": "garments/u/g.glb", "upload_url": _url("up/glb")},
            {"name": "image", "path": "garments/u/g.png", "upload_url": _url("up/img")},
        ]
    elif job_type == "drape":
        inp = {"avatar_id": str(uuid.uuid4()), "garment_id": str(uuid.uuid4()), "size_label": "M", "pose": "a_pose", "quality": "preview"}
        urls = {}
        outs = [{"name": "glb", "path": "drapes/u/d.glb", "upload_url": _url("up/glb")}]
    else:
        inp = {"selfie_path": "raw-uploads/u/selfie.jpg", "white_reference": "paper", "consent_id": cid}
        urls = {"raw-uploads/u/selfie.jpg": _url("raw-uploads/u/selfie.jpg")}
        outs = []
    d = {
        "job_id": job_id, "type": job_type, "input": inp, "input_urls": urls, "output_uploads": outs,
        "callback_url": "https://example.supabase.co/functions/v1/jobs/callback", "attempt": 1,
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
