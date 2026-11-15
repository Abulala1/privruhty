from app.core import (
    detect,
    plan,
    valid_card,
    shift_dates,
    scale_numbers,
    sanitize_csv,
    sanitize_txt,
)


def test_detection():
    text = "Email a@example.com, call 415-555-0199, card 4111 1111 1111 1111, key sk-abcdefghijklmnopqrstuvwxyz."
    assert {"EMAIL", "PHONE", "CREDIT_CARD", "API_KEY"} <= {
        x.type for x in detect(text, use_presidio=False)
    }
    assert not valid_card("4111 1111 1111 1112")


def test_mapping_and_unicode():
    text = "😀 alice@example.com and alice@example.com versus bob@example.com"
    result = plan(text, use_presidio=False)
    assert result["protected"].count("EMAIL_1") == 2
    assert "EMAIL_2" in result["protected"]
    assert result["spans"][0]["start"] == 2


def test_numeric_policy():
    result = plan("Calculate the average of $100 and $200", use_presidio=False)
    assert not result["safe_to_submit"]
    assert "$100" in result["protected"]
    assert scale_numbers([12, 8], 2) == ["24", "16"]
    assert shift_dates(["2026-12-01", "2026-12-15"], 31) == ["2027-01-01", "2027-01-15"]


def test_documents():
    data, _ = sanitize_txt(b"Email a@example.com", use_presidio=False)
    assert b"EMAIL_1" in data
    data, _ = sanitize_csv(b"name,email\nA,a@example.com\nA,a@example.com\n", use_presidio=False)
    assert data.count(b"EMAIL_1") == 2


def test_names_are_detected_without_manual_terms():
    import pytest

    spacy = pytest.importorskip("spacy")
    if not spacy.util.is_package("en_core_web_sm"):
        pytest.skip("Install en_core_web_sm to test automatic name detection")
    result = plan(
        "Write an email to Alice Tan at alice@example.com about her overdue invoice.",
        use_presidio=True,
    )
    assert any(s["type"] == "PERSON" for s in result["spans"])
    assert "Alice Tan" not in result["protected"]
    assert "PERSON_1" in result["protected"]
