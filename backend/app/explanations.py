"""Metadata-only education. No prompt, mapping, document, or transcript fields."""

import json
import os
import re
from typing import Literal
import httpx
from pydantic import BaseModel, ConfigDict, Field


class ExplanationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    detected_type: Literal[
        "PERSON",
        "EMAIL",
        "PHONE",
        "ADDRESS",
        "LOCATION",
        "CREDIT_CARD",
        "GOVERNMENT_ID",
        "PASSWORD",
        "API_KEY",
        "SALARY",
        "FINANCIAL",
        "MEDICAL",
        "COMPANY",
        "PROJECT_SECRET",
        "CUSTOM",
    ]
    task_type: Literal["GENERAL", "WRITING", "CALCULATION", "DATA_ANALYSIS", "MEDICAL"]
    suggested_strategy: Literal["PSEUDONYM", "BLOCK", "MANUAL_REVIEW", "KEEP"]
    explanation_level: Literal["SIMPLE", "DETAILED", "LEARN_MORE"]
    question_type: Literal[
        "EXPLAIN_RISK",
        "EXPLAIN_REPLACEMENT",
        "EXPLAIN_PHISHING",
        "EXPLAIN_CORRECTNESS",
        "SIMPLIFY",
        "GIVE_EXAMPLE",
    ]
    consent: Literal[True]


class Explanation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=1200)
    simple_explanation: str = Field(min_length=1, max_length=1200)
    risk: str = Field(min_length=1, max_length=1200)
    recommended_action: Literal["REPLACE", "BLOCK", "REVIEW", "KEEP"]
    reason: str = Field(min_length=1, max_length=1200)
    limitation: str = Field(min_length=1, max_length=1200)


def explain(body: ExplanationRequest):
    key = os.environ.get("GEMINI_API_KEY", "")
    model = os.environ.get("GEMINI_MODEL", "")
    if not key or not re.fullmatch(r"[a-zA-Z0-9._-]{1,100}", model):
        return {
            "source": "unavailable",
            "reason": "Gemini is not configured. Use local explanations.",
        }
    metadata = body.model_dump(exclude={"consent"})
    payload = {
        "systemInstruction": {
            "parts": [
                {
                    "text": "Explain cybersecurity calmly and accessibly. You receive category metadata only. Never request originals. Do not execute actions or provide tools. Explain loss of correctness when exact values matter. Credentials must be blocked. Keep advice educational and concise. Never claim anonymization is complete or guarantees safety."
                }
            ]
        },
        "contents": [{"role": "user", "parts": [{"text": json.dumps(metadata)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": Explanation.model_json_schema(),
            "maxOutputTokens": 1500,
        },
    }
    try:
        with httpx.Client(timeout=15) as client:
            response = client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"x-goog-api-key": key},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            candidate = data["candidates"][0]
            if candidate.get("finishReason") != "STOP":
                raise ValueError("Incomplete response")
            raw = "".join(p.get("text", "") for p in candidate["content"]["parts"])
            if len(raw) > 12000:
                raise ValueError("Oversized response")
            parsed = Explanation.model_validate_json(raw)
            # The provider cannot authorize keeping a blocked credential.
            if body.suggested_strategy == "BLOCK" or body.detected_type in ("PASSWORD", "API_KEY"):
                parsed.recommended_action = "BLOCK"
            elif body.suggested_strategy == "MANUAL_REVIEW":
                parsed.recommended_action = "REVIEW"
            return {"source": "gemini", "explanation": parsed.model_dump()}
    except Exception:
        # Do not return or log provider errors, credentials, or response bodies.
        return {
            "source": "unavailable",
            "reason": "Gemini could not provide a valid explanation. Use local explanations.",
        }
