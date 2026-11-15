import json
from fastapi.testclient import TestClient
from app.main import app, TOKEN
from app import explanations as module

client = TestClient(app)
headers = {"x-pribruhty-token": TOKEN}
metadata = {
    "detected_type": "EMAIL",
    "task_type": "WRITING",
    "suggested_strategy": "PSEUDONYM",
    "explanation_level": "SIMPLE",
    "question_type": "EXPLAIN_RISK",
    "consent": True,
}
answer = {
    "title": "Protect a contact",
    "simple_explanation": "An email may identify someone.",
    "risk": "It reveals contact details.",
    "recommended_action": "REPLACE",
    "reason": "A label may be enough for drafting.",
    "limitation": "Restore the address locally if needed.",
}


def test_auth_consent_and_no_free_text_fields():
    assert client.post("/explain", json=metadata).status_code == 401
    assert (
        client.post("/explain", json={**metadata, "consent": False}, headers=headers).status_code
        == 422
    )
    for field in ("text", "prompt", "original", "transcript", "mappings", "document"):
        assert (
            client.post(
                "/explain", json={**metadata, field: "alice@example.com"}, headers=headers
            ).status_code
            == 422
        )
    assert (
        client.post(
            "/explain", json={**metadata, "detected_type": "alice@example.com"}, headers=headers
        ).status_code
        == 422
    )


def test_missing_key_is_honest_fallback(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert client.post("/explain", json=metadata, headers=headers).json()["source"] == "unavailable"


def test_structured_generation_and_local_authority(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-test-key")
    monkeypatch.setenv("GEMINI_MODEL", "synthetic-test-model")
    captured = {}

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "candidates": [
                    {"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(answer)}]}}
                ]
            }

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            captured.update(kwargs)
            return Response()

    monkeypatch.setattr(module.httpx, "Client", FakeClient)
    # Call the module directly so the test's HTTP client is not patched.
    result = module.explain(module.ExplanationRequest(**metadata))
    assert result["source"] == "gemini"
    sent = json.loads(captured["json"]["contents"][0]["parts"][0]["text"])
    assert set(sent) == set(metadata) - {"consent"}
    assert "responseJsonSchema" in captured["json"]["generationConfig"]
    blocked = module.explain(
        module.ExplanationRequest(
            **{**metadata, "detected_type": "API_KEY", "suggested_strategy": "BLOCK"}
        )
    )
    assert blocked["explanation"]["recommended_action"] == "BLOCK"
    answer["recommended_action"] = "EXECUTE"
    try:
        assert module.explain(module.ExplanationRequest(**metadata))["source"] == "unavailable"
    finally:
        answer["recommended_action"] = "REPLACE"


def test_provider_failures_never_echo_errors_or_key(monkeypatch, capsys):
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-test-key")
    monkeypatch.setenv("GEMINI_MODEL", "synthetic-test-model")

    def fail(**kwargs):
        raise RuntimeError("synthetic-test-key private-error")

    monkeypatch.setattr(module.httpx, "Client", fail)
    result = module.explain(module.ExplanationRequest(**metadata))
    assert result["source"] == "unavailable"
    assert "private-error" not in json.dumps(result)
    assert "synthetic-test-key" not in capsys.readouterr().out
