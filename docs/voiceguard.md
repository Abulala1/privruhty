# VoiceGuard setup and demo

VoiceGuard extends Composer, TXT/CSV document review, the inline privacy panel, and the existing detector/word bank. It introduces no new detector or mapping database.

## Local setup

From the project root:

```powershell
& .\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
```

Stop an older backend first if port 8765 is occupied. In a separate terminal, run `npm run build` in `extension`. Reload the unpacked extension from `extension/dist` at `chrome://extensions` and refresh existing chat tabs. Connect the local-service token through Settings. Do not include keys or tokens in demo recordings.

## Real Gemini configuration

Configure environment variables in the terminal that starts the backend:

```powershell
$voiceguardKey = Read-Host 'Gemini API key' -AsSecureString
$env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new('', $voiceguardKey).Password
$env:GEMINI_MODEL = Read-Host 'Supported structured-output model ID from Google AI Studio'
& .\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
```

No new Python dependency is needed; existing HTTPX calls Google's REST API. `.env` files are ignored by version control, but not automatically loaded. Choose a model available to your account supporting [structured output](https://ai.google.dev/gemini-api/docs/structured-output). See [generateContent documentation](https://ai.google.dev/api/generate-content).

Enable optional Gemini explanations in Settings. Each review asks for explicit metadata consent before **Explain** or a predefined topic sends anything to Google. Only category, task, strategy, explanation level, and topic enum values are sent. The backend strips the consent field before calling Google. No original text, documents, mappings, audio, raw questions, or transcripts enter the request. Google can still observe this approved metadata and connection information.

The UI identifies real Gemini output versus local/fallback explanations. Missing keys, unsupported models, invalid responses, and network errors never produce fabricated Gemini results. If fallback is disabled, a failed cloud request displays an error. API keys remain in backend environment variables, outside the extension.

## Review workflow

Replace/Keep update existing selections; Undo/Redo restore choices and review position without changing allocated placeholders. The source stays in the private editor. Credentials cannot be kept or restored. Manual-review values continue to block approval.

**Approve Draft** marks the current draft approved without sending, copying, downloading, or inserting anything. Composer requires a separate **Confirm copy** or **Confirm insert**. Documents requires a separate download action. Editing/rescanning invalidates approval. The inline panel's **Accessible VoiceGuard review** uses the same component, followed by **Insert reviewed changes** and **Confirm insert**. Use Composer for confidential input because host pages can observe typing in their own editors.

## Speech compatibility

Recognition requires `SpeechRecognition.available`, `processLocally`, and an installed on-device `en-US` pack. A prefixed implementation must expose the same guarantees. Detection is capability-based, not a promise that every Chrome installation supports it. Browser policies and extension/page contexts may prevent recognition. See [processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally) and [language-pack availability](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static).

Inline review uses a compact card with the current replacement, Change/Keep/Next, a microphone toggle, and a close button. Explanations, preferences, typed commands, and whole-draft approval are under More options. Composer and Documents retain the full review interface. Opening VoiceGuard attempts local recognition when enabled, supported, and permitted. The microphone icon beside the draggable shield opens speech review. In inline chat review, **change** applies the current finding directly to the editor and resumes speech review after rescanning; **next** only advances. This explicit command does not send a message. Composer and Documents keep preview selection and separate approval/export controls. Grant microphone permission and click **Start private voice** if Chrome requires activation. **Install local English pack** explicitly requests a model download when supported. There is no cloud recognition fallback. Unavailable recognition displays: “Private voice recognition is unavailable in this browser. You can continue using keyboard controls.”

A session recognizes individual utterances, resuming only within the visible active review. It stops on approval, cancellation, Stop, unmount/navigation, a hidden document, errors, or after five minutes. It starts automatically when an enabled, visible VoiceGuard review opens. Stop prevents listening until restarted or a new review opens. Microphone audio and transcripts are never saved to storage or uploaded. The last recognized phrase is displayed for up to eight seconds in the visible review, then cleared; inline review is part of the host page DOM. Recognition pauses during spoken output. TTS uses only voices reporting `localService=true`; otherwise text remains available. Read/Repeat explicitly request audio; automatic feedback can be disabled. Reading a draft with kept originals may disclose them to people nearby.

## Synthetic demo

1. Enter `Email alex@example.com or call 415-555-0199.` in Composer and wait for detection.
2. Open speech review using the microphone icon. Verify Listening status; grant microphone access or start manually if Chrome requires it.
3. Say “Read my warnings”, “Explain the first one”, “Keep it”, “Undo”, “Replace it”, “Next”, “Explain this”, “Keep it”, “Undo”, “Redo”, and “Read the message”.
4. Try “What does phishing mean?” or “Will replacing this change the AI answer?” These map to predefined intents; arbitrary questions remain local.
5. Say “Approve”. Nothing is sent and listening stops. The external sharing confirmation deliberately stays outside voice command dispatch. In another session, “Cancel” stops listening and closes review.
6. Edit the draft to show approval invalidation. Repeat with a synthetic TXT/CSV document.

Buttons and the typed allowlisted command field provide equivalent keyboard actions. Tab/Enter work throughout. Alt+Left/Right changes items; Alt+Enter approves; Escape cancels when focus is inside review. Voice-only review after starting requires a real supported microphone/browser; approval is the end of that review, not permission to send.

## Verification and limits

Unit tests cover command allowlisting, metadata construction, all education categories, history, local capability checks, permission denial, local TTS, and echo suppression. Backend tests cover authentication, consent, private-field rejection, structured payloads, invalid/provider failures, and credential policy. Browser tests check keyboard/focus/labels, live status, high contrast, large text, approval invalidation, document export, inline insertion confirmation, and synthetic speech dispatch. Existing chat, file encryption, page switching, and reload regressions remain tested.

Speech and Gemini doubles are used only in labelled automated fixtures. Real microphone accuracy, local pack installation, local TTS availability, live Gemini responses, and human screen-reader testing remain device/credential-dependent. Automated labels/focus checks are not WCAG certification. Education covers more categories than the current detector can reliably identify; detection still misses or misclassifies information. English commands only. Shadow/page policies may limit browser APIs.

No Vultr deployment, Cursor/Grok qualification, Coder workspace usage, disabled-user study, or sponsor eligibility is claimed. Sponsor evidence must reflect actual work performed.

## Implementation inventory and results

Created:

- `extension/src/voiceguard.ts`, `speech.ts`, `VoiceGuardReview.tsx`, `VoiceGuardSettings.tsx`, `inlineVoiceGuard.tsx`, `voiceguardStyle.ts`.
- `extension/src/voiceguard.test.ts`, `speech.test.ts`.
- `backend/app/explanations.py`, `backend/tests/test_explanations.py`.
- `docs/voiceguard.md`, `docs/sponsors/coder-for-good.md`, `docs/sponsors/gemini-api.md`.

Modified:

- `extension/src/composer.tsx`, `documents.tsx`, `settings.tsx`, `content.ts`, `background.ts`, `background.test.ts`.
- `extension/e2e/extension.spec.ts`, `extension/package.json` (production minification for the expanded inline script).
- `.gitignore`, `README.md`, `docs/security.md`, `docs/architecture.md`.

Verification on November 14, 2026: production build passed; 24 Vitest tests passed; 11 pytest tests passed; all 8 Playwright browser tests passed. The VoiceGuard keyboard/document/inline test was also rerun after final approval/focus changes. A real local backend health check passed and its consent-false explanation request returned HTTP 422 without calling Google. Built JavaScript was checked for absence of the Gemini provider endpoint and backend key-environment access. Live microphone, human screen-reader, and real Gemini-provider validation remain outstanding as described above.

### Speech troubleshooting

Microphone permission and the local English pack are separate requirements. Chrome may report a pack as downloadable even when recognition is supported. Privruhty now distinguishes missing packs, active downloads, denied permission, missing microphones, and unsupported recognition. Use **Set up English and start listening** to install the pack and begin recognition; stopping or closing review cancels any pending automatic start.

The spoken **change** command previously only selected a preview replacement. Inline review now treats it as approval to apply that single current finding to the chat editor. Manual-review policies still block unsafe changes. **Replace it** retains preview selection behavior.

### Easier commands

Say **apply it**, **apply**, **replace**, or **change this** to approve the current inline replacement. **Next item** advances without changing text. Polite forms such as **please apply it** are accepted. Full-command matching rejects negated and unrelated sentences. Supported local engines receive moderate command phrase hints; unsupported hints are disabled without switching to remote recognition. The temporary Heard display helps diagnose recognition mistakes.

Short replacement commands now accept **changed**, **applied**, and close spellings/pronunciations. Matching tolerates one character insertion, deletion, substitution, or adjacent transposition in the replacement verb, plus specific split pronunciations such as **a ply**. Only a short verb with an optional **it**, **this**, or **now** is eligible; arbitrary sentences and negated phrases are rejected. Approval commands do not use approximate matching. Microphone accuracy still depends on the local recognizer.

Repeated replacement words such as **change changed**, **change change**, or **apply applied** are handled as one edit. Mixed commands and negations are rejected. The scan pipeline also removes findings contained in existing placeholders and suggestions that would leave the text unchanged, so review proceeds to the next actionable finding.
