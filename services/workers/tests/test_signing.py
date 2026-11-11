import json

from conftest import EXAMPLES
from probador_workers.signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, canonical_body, sign, signed_headers, verify, verify_request

NOW = 1_800_000_000


def test_roundtrip_and_tamper():
    body = canonical_body({"b": 1, "a": "é"})
    h = signed_headers(body, "s3cret", now=NOW)
    sig, ts = h[SIGNATURE_HEADER], h[TIMESTAMP_HEADER]
    assert sig.startswith("sha256=") and ts == str(NOW)
    assert verify_request(body, h, "s3cret", now=NOW)
    assert not verify(body + b" ", sig, ts, "s3cret", now=NOW)
    assert not verify(body, sig, ts, "other", now=NOW)
    assert not verify(body, None, ts, "s3cret", now=NOW)
    assert not verify(body, sig, None, "s3cret", now=NOW)
    assert not verify(body, sig, ts, "", now=NOW)


def test_timestamp_is_signed_and_bounds_replay():
    body = b"{}"
    h = signed_headers(body, "k", now=NOW)
    # reenvío fuera de la ventana de tolerancia, en ambos sentidos
    assert verify_request(body, h, "k", now=NOW + 300)
    assert not verify_request(body, h, "k", now=NOW + 301)
    assert not verify_request(body, h, "k", now=NOW - 301)
    # no se puede refrescar el timestamp sin el secreto
    assert not verify(body, h[SIGNATURE_HEADER], str(NOW + 200), "k", now=NOW + 200)
    for bad in ("", "abc", "1.5", "-1", " ", "9" * 13):
        assert not verify(body, sign(body, "k", bad or 0), bad, "k", now=NOW)


def test_shared_vector_from_contracts():
    """El mismo vector lo comprueban packages/contracts (Node) y supabase/tests (Deno)."""
    v = json.loads((EXAMPLES.parent / "fixtures" / "signature-vector.json").read_text(encoding="utf-8"))
    assert sign(v["body"].encode("utf-8"), v["secret"], v["timestamp"]) == v["signature"]
    assert verify(v["body"].encode("utf-8"), v["signature"], v["timestamp"], v["secret"], now=int(v["timestamp"]) + 10)


def test_canonical_body_is_deterministic():
    assert canonical_body({"a": 1, "b": 2}) == canonical_body({"b": 2, "a": 1})
