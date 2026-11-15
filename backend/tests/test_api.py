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
