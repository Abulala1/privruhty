import csv
import io
import re
from functools import lru_cache
from collections import defaultdict
from dataclasses import dataclass, asdict
from datetime import date, timedelta
from decimal import Decimal

EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE = re.compile(r"(?<!\w)(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\w)")
CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
SECRET = re.compile(
    r"\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{20,}|(?:api[_ -]?key|password|access[_ -]?token)\s*[:=]\s*[^\s,;]{6,})",
    re.I,
)
IP = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
MONEY = re.compile(r"(?<!\w)\$\s?\d[\d,]*(?:\.\d{2})?\b")


@dataclass
class Span:
    start: int
    end: int
    type: str
    confidence: float
    replacement: str = ""
    strategy: str = "PSEUDONYM"
    reason: str = ""


def valid_card(value):
    digits = [int(c) for c in value if c.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for index, digit in enumerate(reversed(digits)):
        if index % 2:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def classify(text):
    t = text.lower()
    rules = [
        ("MEDICAL", r"\b(dosage|diagnos|patient|medication)\b"),
        ("CALCULATION", r"\b(calculate|average|sum|total|difference|percent)\b"),
        ("DATA_ANALYSIS", r"\b(analy[sz]e|dataset|correlation)\b"),
        ("TIMELINE", r"\b(timeline|schedule|deadline)\b"),
        ("LOCATION", r"\b(directions|nearby|route)\b"),
        ("TRANSLATION", r"\btranslate\b"),
        ("SUMMARIZATION", r"\b(summarize|summary)\b"),
        ("CODING", r"\b(code|debug|script)\b"),
        ("WRITING", r"\b(write|draft|email)\b"),
    ]
    return next((name for name, pattern in rules if re.search(pattern, t)), "GENERAL")


def detect(text, custom=(), use_presidio=True):
    candidates = []

    def add(pattern, kind, confidence, validate=None):
        for m in pattern.finditer(text):
            if not validate or validate(m.group()):
                candidates.append(Span(m.start(), m.end(), kind, confidence))

    for args in [
        (SECRET, "API_KEY", 0.99, None),
        (EMAIL, "EMAIL", 0.99, None),
        (PHONE, "PHONE", 0.9, None),
        (CARD, "CREDIT_CARD", 0.99, valid_card),
        (IP, "IP_ADDRESS", 0.8, lambda x: all(int(p) < 256 for p in x.split("."))),
        (SSN, "GOVERNMENT_ID", 0.96, None),
        (MONEY, "FINANCIAL", 0.86, None),
    ]:
        add(*args)
    for term in custom:
        if term and len(term) <= 100:
            add(re.compile(re.escape(term), re.I), "CUSTOM", 0.99)
    if use_presidio:
        try:
            engine = presidio_engine()
            mapping = {
                "PERSON": "PERSON",
                "LOCATION": "LOCATION",
                "ORGANIZATION": "COMPANY",
                "DATE_TIME": "DATE",
                "US_DRIVER_LICENSE": "GOVERNMENT_ID",
            }
            for item in engine.analyze(
                text=text, language="en", entities=list(mapping), score_threshold=0.65
            ):
                candidates.append(
                    Span(item.start, item.end, mapping[item.entity_type], round(item.score, 2))
                )
        except (ImportError, OSError, ValueError):
            pass
    priority = {
        "API_KEY": 0,
        "CREDIT_CARD": 1,
        "GOVERNMENT_ID": 2,
        "EMAIL": 3,
        "PHONE": 4,
        "CUSTOM": 5,
    }
    candidates.sort(key=lambda s: (priority.get(s.type, 9), -(s.end - s.start), s.start))
    chosen = []
    for span in candidates:
        if not any(span.start < old.end and old.start < span.end for old in chosen):
            chosen.append(span)
    return sorted(chosen, key=lambda s: s.start)


@lru_cache(maxsize=1)
def presidio_engine():
    from presidio_analyzer import AnalyzerEngine
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    config = {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
    }
    return AnalyzerEngine(nlp_engine=NlpEngineProvider(nlp_configuration=config).create_engine())


def plan(text, custom=(), categories=None, use_presidio=True):
    task = classify(text)
    spans = detect(text, custom, use_presidio)
    counters = defaultdict(int)
    mapping = {}
    warnings = []
    selected = set(categories) if categories is not None else None
    for s in spans:
        original = text[s.start : s.end]
        if s.type == "API_KEY":
            s.replacement = "[SECRET REMOVED]"
            s.strategy = "BLOCK"
            s.reason = "Credentials must not be sent to an AI service."
        elif s.type == "FINANCIAL" and task in ("CALCULATION", "DATA_ANALYSIS", "MEDICAL"):
            s.replacement = original
            s.strategy = "MANUAL_REVIEW"
            s.reason = "Changing this value may invalidate the answer."
            warnings.append(
                "Exact financial values remain. Compute locally or remove them before sending."
            )
        else:
            key = (s.type, original.casefold())
            if key not in mapping:
                counters[s.type] += 1
                mapping[key] = f"{s.type}_{counters[s.type]}"
            s.replacement = mapping[key]
            s.reason = "A consistent placeholder keeps repeated references linked."
            if s.type == "FINANCIAL":
                warnings.append("Replacing amounts prevents exact calculations.")
        if selected is not None and s.type not in selected and s.type != "API_KEY":
            s.replacement = original
            s.strategy = "KEEP"
            s.reason = "Category excluded by user."
    protected = apply(text, spans)
    return {
        "task": task,
        "spans": [asdict(s) for s in spans],
        "protected": protected,
        "warnings": sorted(set(warnings)),
        "safe_to_submit": not any(s.strategy == "MANUAL_REVIEW" for s in spans),
    }


def apply(text, spans):
    for s in sorted(spans, key=lambda x: x.start, reverse=True):
        text = text[: s.start] + s.replacement + text[s.end :]
    return text


def shift_dates(values, days):
    return [(date.fromisoformat(v) + timedelta(days=days)).isoformat() for v in values]


def scale_numbers(values, factor):
    factor = Decimal(str(factor))
    if factor <= 0:
        raise ValueError("factor must be positive")
    return [str(Decimal(str(v)) * factor) for v in values]


def sanitize_txt(data, **kwargs):
    text = data.decode("utf-8-sig")
    result = plan(text, **kwargs)
    return result["protected"].encode("utf-8"), result


def sanitize_csv(data, **kwargs):
    text = data.decode("utf-8-sig")
    source = csv.reader(io.StringIO(text, newline=""))
    rows = list(source)
    all_text = "\n".join("\t".join(r) for r in rows)
    # Plan globally so repeated values use the same placeholder across rows.
    result = plan(all_text, **kwargs)
    replacements = {}
    for s in result["spans"]:
        replacements[(s["type"], all_text[s["start"] : s["end"]])] = s["replacement"]
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    for row in rows:
        protected = []
        for cell in row:
            cell_spans = detect(cell, kwargs.get("custom", ()), kwargs.get("use_presidio", True))
            for s in cell_spans:
                s.replacement = replacements.get(
                    (s.type, cell[s.start : s.end]), cell[s.start : s.end]
                )
            protected.append(apply(cell, cell_spans))
        writer.writerow(protected)
    return out.getvalue().encode("utf-8"), result
