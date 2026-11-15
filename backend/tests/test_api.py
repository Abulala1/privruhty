from fastapi.testclient import TestClient
from app.main import app, TOKEN

client = TestClient(app, raise_server_exceptions=False)


def test_unauthorized():
    assert client.post("/scan", json={"text": "hello"}).status_code == 401
    assert (
        client.post(
            "/scan",
            json={"text": "hello"},
            headers={"origin": "https://evil.example", "x-pribruhty-token": TOKEN},
        ).status_code
        == 403
    )


def test_scan():
    result = client.post(
        "/scan", json={"text": "a@example.com"}, headers={"x-pribruhty-token": TOKEN}
    )
    assert result.status_code == 200
    assert result.json()["protected"] == "EMAIL_1"


def test_cloud_origin_allowlist_and_no_cache(monkeypatch):
    import app.main as service

    allowed = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    monkeypatch.setattr(service, "ALLOWED_ORIGINS", {allowed})
    blocked = client.post(
        "/scan",
        json={"text": "a@example.com"},
        headers={"origin": "chrome-extension://other", "x-pribruhty-token": TOKEN},
    )
    assert blocked.status_code == 403
    approved = client.post(
        "/scan",
        json={"text": "a@example.com"},
        headers={"origin": allowed, "x-pribruhty-token": TOKEN},
    )
    assert approved.status_code == 200
    assert approved.headers["access-control-allow-origin"] == allowed
    assert approved.headers["cache-control"] == "no-store"
    assert client.post("/scan", json={"text": "hello"}).status_code == 401
