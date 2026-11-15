# Best Use of Gemini API: cybersecurity education

Gemini provides short explanations of detected privacy categories, replacement strategies, and correctness limitations within the actual review workflow. Predefined topics cover risk, replacement, phishing, correctness, simplification, and examples.

## Privacy-safe integration

`extension/src/voiceguard.ts` constructs five enum fields: detected_type, task_type, suggested_strategy, explanation_level, and question_type. The service worker validates exact keys/values and explicit consent. The token-protected local `/explain` endpoint uses Pydantic enums and forbids extra fields. Only those five fields reach Google; originals, documents, mappings, audio, and raw questions/transcripts are excluded by construction.

`backend/app/explanations.py` calls generateContent with fixed education instructions, JSON MIME type, and a response schema. Required fields are title, simple_explanation, risk, recommended_action, reason, and limitation. Bounded strings, enumerated recommendations, and extra-field rejection are validated again locally. React renders model output as text. No tools or privileged actions are available.

Credentials stay blocked and manual-review policy remains authoritative. Gemini cannot change selections, access mappings, approve, or send anything. Real provider failures and malformed responses become honest unavailable results. Prewritten local explanations cover all requested categories and remain the default without cloud consent.

## Setup and remaining demonstration

Configure backend-only `GEMINI_API_KEY` and `GEMINI_MODEL`; enable optional explanations and explicit per-review metadata consent. See [setup instructions](../voiceguard.md). No API key is bundled or entered in extension settings.

Integration is implemented and tested with synthetic HTTP doubles. No live key/response has been verified. Before submission, perform a real consented metadata request, show the Gemini source label, record the actual model, and demonstrate local fallback. Do not claim live sponsor demonstration or Vultr deployment until performed.

References: [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [generateContent](https://ai.google.dev/api/generate-content).
