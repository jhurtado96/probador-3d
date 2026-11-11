from probador_workers.signing import canonical_body, sign, verify


def test_roundtrip_and_tamper():
    body = canonical_body({"b": 1, "a": "é"})
    sig = sign(body, "s3cret")
    assert sig.startswith("sha256=")
    assert verify(body, sig, "s3cret")
    assert not verify(body + b" ", sig, "s3cret")
    assert not verify(body, sig, "other")
    assert not verify(body, None, "s3cret")
    assert not verify(body, sig, "")


def test_known_vector():
    # HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    assert sign(b"The quick brown fox jumps over the lazy dog", "key") == (
        "sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
    )


def test_canonical_body_is_deterministic():
    assert canonical_body({"a": 1, "b": 2}) == canonical_body({"b": 2, "a": 1})
