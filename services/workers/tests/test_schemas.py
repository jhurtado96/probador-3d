import copy
import json

import pytest

from conftest import EXAMPLES, TOKEN, example, make_dispatch
from probador_workers.errors import ContractError
from probador_workers.schemas import OUTPUT_DEF, problems, validate, validate_callback, validate_dispatch


@pytest.mark.parametrize("f", sorted(p.name for p in EXAMPLES.glob("*.json")))
def test_examples_validate_against_job_schema(f):
    assert problems("job", example(f)) == []


def test_drape_example_output_matches_callback_output_schema():
    out = example("Job.drape-succeeded.json")["output"]
    validate("job_callback", out, OUTPUT_DEF["drape"])


def test_dispatch_built_from_avatar_example_is_valid():
    ex = example("Job.avatar-queued.json")
    d = make_dispatch("avatar", job_id=ex["id"])
    d["input"] = ex["input"]
    d["input_urls"] = {ex["input"]["photo_path"]: "https://example.supabase.co/x?token=t"}
    validate_dispatch(d)


def test_all_types_valid(job_type):
    validate_dispatch(make_dispatch(job_type))


def test_rejects_extra_and_missing_fields():
    d = make_dispatch("avatar")
    d["extra"] = 1
    with pytest.raises(ContractError):
        validate_dispatch(d)
    d = make_dispatch("avatar")
    del d["input"]["height_cm"]
    with pytest.raises(ContractError):
        validate_dispatch(d)


def test_rejects_input_of_wrong_type_even_though_anyof_is_loose():
    d = make_dispatch("avatar")
    d["input"] = make_dispatch("color")["input"]
    with pytest.raises(ContractError):
        validate_dispatch(d)


def test_requires_download_url_for_each_input_path():
    d = make_dispatch("avatar")
    d["input_urls"] = {}
    with pytest.raises(ContractError):
        validate_dispatch(d)


def test_error_messages_never_include_values():
    d = make_dispatch("avatar")
    d["callback_url"] = f"not a url?token={TOKEN}"
    d["input_urls"] = {k: v for k, v in d["input_urls"].items()}
    d["attempt"] = f"x{TOKEN}"
    with pytest.raises(ContractError) as e:
        validate_dispatch(d)
    assert TOKEN not in str(e.value)


def test_callback_requires_output_or_error():
    base = {"job_id": make_dispatch("color")["job_id"], "attempt": 1, "worker_version": "x"}
    with pytest.raises(ContractError):
        validate_callback({**base, "status": "succeeded"}, "color")
    with pytest.raises(ContractError):
        validate_callback({**base, "status": "failed"}, "color")
    validate_callback({**base, "status": "running", "progress": 0.3, "stage": "s"}, "color")
