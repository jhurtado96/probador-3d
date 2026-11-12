"""Validación de la foto, salida `AvatarJobOutput` contra el esquema y manejador real con el pipeline simulado (sin GPU)."""

import io
import logging

import httpx
import numpy as np
import pytest

from conftest import TOKEN, USER_ID, make_dispatch
from probador_workers.avatar import glb, measure, output, validate
from probador_workers.avatar.validate import COCO, Detection
from probador_workers.errors import JobFailure
from probador_workers.http_client import ListSink, TransferClient
from probador_workers.logging_setup import JsonFormatter
from probador_workers.runner import execute
from probador_workers.schemas import validate_callback
from synthetic_body import synthetic_body

W, H = 1000, 2000


def person(cx=500.0, top=150.0, bottom=1900.0, score=0.98, sitting=False, crop_feet=False, kp_score=5.0,
           facing="front") -> Detection:
    h = bottom - top
    y = {
        "nose": top + 0.06 * h, "left_eye": top + 0.05 * h, "right_eye": top + 0.05 * h, "left_ear": top + 0.06 * h,
        "right_ear": top + 0.06 * h, "left_shoulder": top + 0.18 * h, "right_shoulder": top + 0.18 * h,
        "left_elbow": top + 0.33 * h, "right_elbow": top + 0.33 * h, "left_wrist": top + 0.45 * h,
        "right_wrist": top + 0.45 * h, "left_hip": top + 0.50 * h, "right_hip": top + 0.50 * h,
        "left_knee": top + 0.73 * h, "right_knee": top + 0.73 * h, "left_ankle": top + 0.96 * h,
        "right_ankle": top + 0.96 * h,
    }
    if sitting:
        for s in ("left", "right"):
            y[f"{s}_knee"] = y[f"{s}_hip"] + 0.02 * h
    kps = np.zeros((17, 3))
    for name, i in COCO.items():
        # de frente, el lado izquierdo de la persona sale a la derecha de la imagen
        dx = 120 if name.startswith("left") else (-120 if name.startswith("right") else 0)
        if facing == "back":
            dx = -dx
        elif facing == "profile":
            dx = dx * 0.05
        kps[i] = [cx + dx, y[name], kp_score]
    if crop_feet:
        kps[COCO["left_ankle"], 2] = kps[COCO["right_ankle"], 2] = -3
    return Detection(np.array([cx - 200, top, cx + 200, bottom]), score, kps)


def test_valid_photo_passes():
    det = validate.check_photo([person()], W, H)
    assert validate.detection_quality(det) == pytest.approx(0.98)


@pytest.mark.parametrize(
    "dets,code",
    [
        ([], "no_person_detected"),
        ([person(score=0.5)], "no_person_detected"),
        ([person(cx=300), person(cx=700)], "multiple_people"),
        ([person(crop_feet=True)], "body_not_fully_visible"),
        ([person(bottom=H + 300)], "body_not_fully_visible"),
        ([person(top=1500, bottom=1950)], "low_image_quality"),
        ([person(sitting=True)], "pose_invalid"),
        ([person(facing="profile")], "pose_invalid"),
        ([person(facing="back")], "pose_invalid"),
    ],
)
def test_invalid_photos_fail_with_contract_codes(dets, code):
    with pytest.raises(JobFailure) as e:
        validate.check_photo(dets, W, H)
    assert e.value.code == code
    assert e.value.retryable is False


def test_small_background_person_is_tolerated():
    validate.check_photo([person(), person(cx=900, top=900, bottom=1100, score=0.9)], W, H)


def _png(w, h) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (w, h), (120, 110, 100)).save(buf, format="PNG")
    return buf.getvalue()


def test_decode_image():
    arr = validate.decode_image(_png(600, 1200))
    assert arr.shape == (1200, 600, 3) and arr.dtype == np.uint8
    big = validate.decode_image(_png(1500, 3000))
    assert max(big.shape[:2]) == validate.MAX_SIDE
    with pytest.raises(JobFailure) as e:
        validate.decode_image(_png(100, 200))
    assert e.value.code == "low_image_quality"
    with pytest.raises(JobFailure) as e:
        validate.decode_image(b"no es una imagen")
    assert e.value.code == "invalid_input"


def _result() -> output.AvatarResult:
    v, f, kp = synthetic_body()
    m = measure.measure_body(v, f, kp).measurements_cm
    return output.AvatarResult(
        glb=glb.export_glb(v, f),
        measurements_cm=m,
        shape_params=[0.1] * 45 + [0.0] * 28 + [1.02],
        pose="t_pose",
        model_version=output.model_version("vith", "0123456789abcdef", "b5c765a0d89d"),
        detection_quality=0.9,
        weight_fit="converged",
        metrics={"sam3db_s": 1.2},
    )


def test_output_is_valid_against_schema():
    res = _result()
    inp = {"photo_path": "raw-uploads/u/p.jpg", "height_cm": 175, "weight_kg": 70, "consent_id": "5e2a9d7c-1b34-4c8a-8f10-7d6f3a2b9c02"}
    out = output.build_output("5e2a9d7c-1b34-4c8a-8f10-7d6f3a2b9c03", USER_ID, inp, "storage://assets/u/avatars/a.glb", res)
    cb = {"job_id": "5e2a9d7c-1b34-4c8a-8f10-7d6f3a2b9c04", "attempt": 1, "worker_version": "avatar-0.1.0",
          "status": "succeeded", "progress": 1, "output": out}
    validate_callback(cb, "avatar")
    a = out["avatar"]
    assert a["body_model"] == "mhr" and a["measurements_source"] == "photo"
    assert a["measurements"]["height_cm"] == 175 and a["measurements"]["weight_kg"] == 70
    assert set(a["measurements_sigma_cm"]) <= set(a["measurements"])
    assert a["measurements_sigma_cm"]["chest_cm"] < output.BASE_SIGMA_CM["chest_cm"]  # el peso ayudó
    assert 0 < a["confidence"] <= output.CONFIDENCE_CAP
    assert a["model_version"] == "mhr-lod1/sam-3d-body-vith@0123456/code@b5c765a/avatar-p0.1"
    assert not a["model_version"].startswith("fake/")
    assert len(a["shape_hash"]) == 32


def test_real_handler_with_simulated_pipeline(cfg, monkeypatch, caplog):
    from probador_workers.avatar import pipeline

    seen = {}

    class FakeModels:
        pass

    def fake_run(photo, height_cm, weight_kg, models=None, report=None):
        seen["photo"] = bytes(photo)
        seen["height"] = height_cm
        report("estimating_body", 0.4)
        return _result()

    monkeypatch.setattr(pipeline.AvatarModels, "get", classmethod(lambda cls: FakeModels()))
    monkeypatch.setattr(pipeline, "run_pipeline", fake_run)
    reqs = []

    def handler(req: httpx.Request):
        reqs.append((req.method, req.content))
        return httpx.Response(200, content=b"JPEGDATA" if req.method == "GET" else b"")

    caplog.set_level(logging.DEBUG)
    sink = ListSink()
    final = execute(make_dispatch("avatar"), cfg, sink, transfer=TransferClient(cfg, httpx.Client(transport=httpx.MockTransport(handler))), fake=False)
    assert final["status"] == "succeeded", final.get("error")
    for cb in sink.sent:
        validate_callback(cb, "avatar")
    assert "fake" not in final
    assert seen == {"photo": b"JPEGDATA", "height": 172.0}
    assert [m for m, _ in reqs] == ["GET", "PUT"]
    assert reqs[1][1].startswith(b"glTF")
    assert final["output"]["avatar"]["glb_url"].startswith("storage://assets/u/avatars/")
    logs = "\n".join(JsonFormatter().format(r) for r in caplog.records)
    assert "avatar_built" in logs
    for needle in (TOKEN, "chest", "waist", "JPEGDATA", "://"):
        assert needle not in logs  # sin medidas, foto ni URLs en los logs


def test_real_handler_without_weights_fails_before_downloading(cfg, monkeypatch, tmp_path):
    from probador_workers.avatar import pipeline

    monkeypatch.setattr(pipeline, "WEIGHTS_DIR", tmp_path)
    monkeypatch.setattr(pipeline.AvatarModels, "_instance", None)
    reqs = []

    def handler(req):
        reqs.append(req.method)
        return httpx.Response(200, content=b"x")

    final = execute(make_dispatch("avatar"), cfg, ListSink(), transfer=TransferClient(cfg, httpx.Client(transport=httpx.MockTransport(handler))), fake=False)
    assert final["status"] == "failed"
    assert final["error"]["code"] == "internal" and final["error"]["retryable"] is False
    assert "huggingface" in final["error"]["message"]
    assert reqs == []  # la foto no se descarga si no hay modelo
