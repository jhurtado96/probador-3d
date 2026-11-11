"""Arreglos de la revisión de la fase 0 en los workers: A3 (aviso sin datos personales), B3 (SSRF) y B4 (plazos)."""

import json
import re
from pathlib import Path

import httpx
import pytest

from conftest import SECRET, USER_ID, make_dispatch, make_notice
from probador_workers.config import JOB_TIMEOUT_S, Config
from probador_workers.errors import ConfigError, ContractError, TransferError
from probador_workers.http_client import ListSink, TransferClient, check_url, fetch_dispatch
from probador_workers.runner import execute_notice
from probador_workers.schemas import validate_notice
from probador_workers.signing import verify_request


def test_notice_carries_no_personal_data(job_type):
    d = make_dispatch(job_type)
    n = make_notice(d)
    validate_notice(n)
    text = json.dumps(n)
    assert USER_ID not in text and "raw-uploads" not in text and "token" not in text
    for extra in ({"user_id": USER_ID}, {"input": d["input"]}, {"input_urls": d["input_urls"]}):
        with pytest.raises(ContractError):
            validate_notice({**n, **extra})


def test_fetch_dispatch_is_signed_with_callback_secret(cfg):
    d = make_dispatch("avatar")
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=d)

    got = fetch_dispatch(make_notice(d), cfg, httpx.Client(transport=httpx.MockTransport(handler)))
    assert got == d
    assert json.loads(seen[0].content) == {"job_id": d["job_id"], "attempt": 1}
    assert verify_request(seen[0].content, seen[0].headers, SECRET)


def test_fetch_dispatch_refused_is_an_error(cfg):
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(409, json={})))
    with pytest.raises(TransferError):
        fetch_dispatch(make_notice(make_dispatch("color")), cfg, client)


def test_execute_notice_runs_the_fetched_dispatch_and_returns_nothing(cfg):
    d = make_dispatch("color")
    sink = ListSink()
    t = TransferClient(cfg, httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))))
    result = execute_notice(make_notice(d), cfg, fetch=lambda n, c: d, sink_factory=lambda _: sink, transfer=t, fake=True)
    assert result is None  # Modal no guarda resultados: el resultado solo viaja por el callback
    assert sink.sent[-1]["status"] == "succeeded"


def test_execute_notice_rejects_a_dispatch_for_another_job(cfg):
    d = make_dispatch("color")
    other = make_dispatch("color")
    with pytest.raises(ContractError):
        execute_notice(make_notice(d), cfg, fetch=lambda n, c: other, sink_factory=lambda _: ListSink())


@pytest.mark.parametrize("url", [
    "https://10.0.0.1/x", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest",
    "https://metadata.google.internal/x", "https://printer.local/x", "https://localhost/x",
])
def test_ssrf_private_and_ip_literal_hosts_are_rejected(url):
    with pytest.raises(TransferError):
        check_url(url, Config(allow_insecure_localhost=False))


def test_allowed_hosts_are_required_in_production():
    base = dict(env="production", callback_secret="a", dispatch_secret="b", allow_insecure_localhost=False)
    with pytest.raises(ConfigError):
        Config(**base).check()
    Config(**base, allowed_url_hosts=("example.supabase.co",)).check()
    with pytest.raises(TransferError):
        check_url("https://evil.example.com/x", Config(**base, allowed_url_hosts=("example.supabase.co",)))


def test_modal_timeouts_match_api_job_timeouts():
    sql = (Path(__file__).parents[3] / "supabase/migrations/20261111000500_job_queue.sql").read_text()
    api = {t: int(m) * 60 for t, m in re.findall(r"when '(\w+)'\s+then interval '(\d+) minutes'", sql)}
    assert api == JOB_TIMEOUT_S
