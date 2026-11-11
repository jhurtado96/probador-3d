import json
import logging
import struct

import httpx
import pytest

from conftest import SECRET, TOKEN, USER_ID, make_dispatch
from probador_workers.config import Config
from probador_workers.errors import ConfigError, ContractError
from probador_workers.http_client import HttpCallbackSink, ListSink, TransferClient
from probador_workers.logging_setup import JsonFormatter, log_event
from probador_workers.runner import execute
from probador_workers.schemas import validate_callback
from probador_workers.signing import verify_request


def recording_transfer(cfg, requests):
    def handler(req: httpx.Request):
        requests.append((req.method, str(req.url), req.content))
        return httpx.Response(200, content=b"")

    return TransferClient(cfg, httpx.Client(transport=httpx.MockTransport(handler)))


def test_fake_mode_produces_valid_marked_outputs(cfg, job_type):
    reqs, sink = [], ListSink()
    d = make_dispatch(job_type)
    final = execute(d, cfg, sink, transfer=recording_transfer(cfg, reqs), fake=True)
    assert final["status"] == "succeeded"
    assert "fake" in final["worker_version"]
    for cb in sink.sent:
        validate_callback(cb, job_type)
        assert cb["fake"] is True  # marca estándar en todos los callbacks, también los `running`
    out = final["output"]
    entity = out.get("avatar") or out.get("garment") or out.get("color_profile") or out["fit_result"]
    assert entity["user_id"] == USER_ID  # el dueño sale del dispatch, no se inventa
    assert "input_deleted_at" not in out  # el borrado es cosa de la API
    version = entity.get("model_version") or entity.get("pipeline_version")
    assert version is None or version.startswith("fake/")
    if job_type == "drape":
        assert out["cache_key"] == d["context"]["cache_key"]
    if job_type == "garment":
        assert out["garment"]["sewing_pattern_url"] == "storage://assets/u/garments/g/j-a1-pattern.json"
    assert sink.sent[0]["status"] == "running" and sink.sent[-1] is final
    # el modo fake no descarga fotos ni entradas personales
    assert all(m == "PUT" for m, _, _ in reqs)
    # marcado como falso: la marca estándar va en el callback (el drapeado no tiene campo de versión en su salida)
    assert final["fake"] is True
    # los GLB subidos son GLB válidos
    for _, _, body in reqs:
        if body.startswith(b"glTF"):
            version, length = struct.unpack("<II", body[4:12])
            assert version == 2 and length == len(body)
            jlen = struct.unpack("<I", body[12:16])[0]
            assert json.loads(body[20 : 20 + jlen])["asset"]["version"] == "2.0"
    if job_type in ("avatar", "garment", "drape"):
        assert any(b.startswith(b"glTF") for _, _, b in reqs)


def test_real_mode_reports_not_implemented(cfg, job_type):
    sink = ListSink()
    final = execute(make_dispatch(job_type), cfg, sink, transfer=recording_transfer(cfg, []), fake=False)
    assert final["status"] == "failed"
    assert final["error"]["code"] == "not_implemented"
    assert final["error"]["retryable"] is False
    assert "output" not in final and "fake" not in final
    validate_callback(final, job_type)


def test_invalid_dispatch_raises():
    with pytest.raises(ContractError):
        execute({"job_id": "x"}, Config(), ListSink())


def test_missing_output_upload_fails_cleanly(cfg):
    d = make_dispatch("avatar", output_uploads=[])
    final = execute(d, cfg, ListSink(), transfer=recording_transfer(cfg, []), fake=True)
    assert final["status"] == "failed" and final["error"]["code"] == "invalid_input"


def test_upload_failure_is_retryable_and_hides_url(cfg):
    t = TransferClient(cfg, httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    final = execute(make_dispatch("avatar"), cfg, ListSink(), transfer=t, fake=True)
    assert final["error"]["retryable"] is True
    assert TOKEN not in json.dumps(final) and "http" not in final["error"]["message"]


def test_http_callback_is_signed_and_retries(cfg):
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(503 if len(seen) == 1 else 200)

    sink = HttpCallbackSink("https://example.supabase.co/cb", cfg, httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda s: None)
    sink.send({"job_id": "j", "attempt": 1, "status": "running", "worker_version": "v"})
    assert len(seen) == 2
    assert verify_request(seen[-1].content, seen[-1].headers, SECRET)


def test_callback_requires_secret():
    with pytest.raises(ConfigError):
        HttpCallbackSink("https://example.supabase.co/cb", Config())


def test_http_url_rejected_outside_localhost():
    cfg = Config(callback_secret="x", allow_insecure_localhost=True)
    with pytest.raises(Exception):
        HttpCallbackSink("http://evil.example.com/cb", cfg)
    HttpCallbackSink("http://localhost:54321/cb", cfg)


def test_fake_is_refused_in_production():
    with pytest.raises(ConfigError):
        Config(env="production", fake=True, callback_secret="a", dispatch_secret="b", allow_insecure_localhost=False).check()


def test_logs_contain_no_urls_or_tokens(cfg, job_type, caplog):
    caplog.set_level(logging.DEBUG)
    d = make_dispatch(job_type)
    execute(d, cfg, ListSink(), transfer=recording_transfer(cfg, []), fake=True)
    execute(make_dispatch(job_type), cfg, ListSink(), transfer=recording_transfer(cfg, []), fake=False)
    fmt = JsonFormatter()
    out = "\n".join(fmt.format(r) for r in caplog.records)
    assert "job_started" in out
    for needle in (TOKEN, "://", "supabase", "raw-uploads", "photo"):
        assert needle not in out


def test_log_event_redacts():
    rec = logging.LogRecord("t", logging.INFO, "f", 1, "ver https://a.b/c?token=1 listo", (), None)
    rec.ctx = {}
    assert "<redacted-url>" in JsonFormatter().format(rec)
    lg = logging.getLogger("t2")
    lg.setLevel(logging.INFO)
    records = []
    lg.addHandler(type("H", (logging.Handler,), {"emit": lambda s, r: records.append(r)})())
    log_event(lg, "x", photo_url="https://a/b", job_id="j", note="ver https://a/b?token=1")
    assert records[0].ctx == {"job_id": "j", "note": "ver <redacted-url>"}
