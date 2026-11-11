import httpx
from fastapi.testclient import TestClient

from conftest import make_dispatch
from probador_workers.config import Config
from probador_workers.http_client import ListSink, TransferClient
from probador_workers.server import create_app
from probador_workers.signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, canonical_body, signed_headers


def _app(sink):
    cfg = Config(fake=True, callback_secret="c", dispatch_secret="d")
    t = TransferClient(cfg, httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))))
    return TestClient(create_app(cfg, sink_factory=lambda d: sink, transfer=t))


def test_dispatch_accepts_signed_request_and_calls_back():
    sink = ListSink()
    c = _app(sink)
    body = canonical_body(make_dispatch("color"))
    r = c.post("/dispatch", content=body, headers=signed_headers(body, "d"))
    assert r.status_code == 202
    assert sink.sent[-1]["status"] == "succeeded" and sink.sent[-1]["fake"] is True


def test_dispatch_rejects_bad_signature_and_invalid_body():
    c = _app(ListSink())
    body = canonical_body(make_dispatch("color"))
    good = signed_headers(body, "d")
    assert c.post("/dispatch", content=body, headers={**good, SIGNATURE_HEADER: "sha256=00"}).status_code == 401
    assert c.post("/dispatch", content=body, headers={SIGNATURE_HEADER: good[SIGNATURE_HEADER]}).status_code == 401
    assert c.post("/dispatch", content=body, headers=signed_headers(body, "c")).status_code == 401  # secreto del callback
    old = signed_headers(body, "d", now=1_000_000_000)  # firma válida pero antigua: reenvío
    assert c.post("/dispatch", content=body, headers=old).status_code == 401
    assert TIMESTAMP_HEADER in good
    bad = canonical_body({"job_id": "x"})
    assert c.post("/dispatch", content=bad, headers=signed_headers(bad, "d")).status_code == 422


def test_healthz():
    assert _app(ListSink()).get("/healthz").json()["fake"] is True


def test_modal_app_parses_and_declares_region_and_gpu():
    import ast
    from pathlib import Path

    src = (Path(__file__).parents[1] / "modal_app.py").read_text()
    ast.parse(src)
    assert "region=REGION" in src and "gpu=_gpu(job_type)" in src
