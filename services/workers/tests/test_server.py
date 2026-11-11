import httpx
from fastapi.testclient import TestClient

from conftest import make_dispatch
from probador_workers.config import Config
from probador_workers.http_client import ListSink, TransferClient
from probador_workers.server import create_app
from probador_workers.signing import SIGNATURE_HEADER, canonical_body, sign


def _app(sink):
    cfg = Config(fake=True, callback_secret="c", dispatch_secret="d")
    t = TransferClient(cfg, httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))))
    return TestClient(create_app(cfg, sink_factory=lambda d: sink, transfer=t))


def test_dispatch_accepts_signed_request_and_calls_back():
    sink = ListSink()
    c = _app(sink)
    body = canonical_body(make_dispatch("color"))
    r = c.post("/dispatch", content=body, headers={SIGNATURE_HEADER: sign(body, "d")})
    assert r.status_code == 202
    assert sink.sent[-1]["status"] == "succeeded"


def test_dispatch_rejects_bad_signature_and_invalid_body():
    c = _app(ListSink())
    body = canonical_body(make_dispatch("color"))
    assert c.post("/dispatch", content=body, headers={SIGNATURE_HEADER: "sha256=00"}).status_code == 401
    bad = canonical_body({"job_id": "x"})
    assert c.post("/dispatch", content=bad, headers={SIGNATURE_HEADER: sign(bad, "d")}).status_code == 422


def test_healthz():
    assert _app(ListSink()).get("/healthz").json()["fake"] is True


def test_modal_app_parses_and_declares_region_and_gpu():
    import ast
    from pathlib import Path

    src = (Path(__file__).parents[1] / "modal_app.py").read_text()
    ast.parse(src)
    assert "region=REGION" in src and "gpu=_gpu(job_type)" in src
