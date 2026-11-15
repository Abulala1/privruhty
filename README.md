# Pribruhty

**Accessible privacy protection for AI conversations.**

Pribruhty is a Chrome extension with a local Python detection service. It helps you review sensitive information, replace it with consistent placeholders, and choose what to share with ChatGPT, Claude, or Gemini. VoiceGuard adds accessible review and optional metadata-only Gemini explanations.

## Features

| Feature              | What it does                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live chat review     | Detects sensitive text as you type, highlights findings, and offers hover suggestions and a movable review panel.                                      |
| Secure Composer      | Keeps drafts in an extension-owned editor; previews protected text before explicit approval and copy/insertion confirmation.                           |
| Local detection      | Uses patterns for structured identifiers and credentials, plus Presidio/spaCy for names and contextual entities. Custom protected terms are supported. |
| Encrypted word bank  | Keeps consistent per-workspace placeholders and optional passphrase-encrypted original mappings. Credentials are never restored.                       |
| Original-word switch | Toggles known placeholders and their saved originals in rendered conversations, including streaming replies and inline formatting.                     |
| Private reader       | Shows restored values in an extension page or side panel without changing the website's page.                                                          |
| Document protection  | Creates reviewed UTF-8 TXT/CSV copies up to 1 MB, preserving and verifying CSV structure.                                                              |
| File encryption      | Encrypts and decrypts files of any format up to 10 MB with local passphrase-based AES-GCM.                                                             |
| VoiceGuard           | Provides allowlisted voice commands, keyboard controls, one-item review, undo/redo, and explicit draft approval.                                       |
| Accessible review    | Offers simple/detailed lessons, high contrast, adjustable text, visible focus, and screen-reader status announcements.                                 |
| Gemini education     | Optionally explains risks using only consented category/task metadata. Originals, documents, mappings, and voice transcripts are excluded.             |

## Requirements

- Node.js **22.20 or newer supported LTS** and npm. See `extension/package.json` for the supported Node range.
- Python **3.11 or 3.12** for the local Presidio/spaCy service.
- Desktop Chrome with Developer mode for loading the unpacked extension.
- Optional Gemini API credentials for cloud explanations. Local explanations require no API key.

## Quick start (Windows PowerShell)

### 1. Clone the repository

```powershell
git clone https://github.com/Abulala1/privruhty.git
Set-Location privruhty
```

### 2. Start the local detector

Run from the repository root:

```powershell
py -3.11 -m venv backend/.venv
& ./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
& ./backend/.venv/Scripts/python.exe -m spacy download en_core_web_sm
& ./backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
```

Keep this terminal running. The service creates `%USERPROFILE%/.pribruhty-token` on first startup. The token stays outside the repository. Without the backend, the extension still checks common structured identifiers, but new names may be missed.

### 3. Build and load the extension

Open another terminal at the repository root:

```powershell
Set-Location extension
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/dist`. Open Pribruhty Settings, enter the local-service token, save, and choose **Test connection**.

After every extension rebuild/reload, refresh existing AI chat tabs. Old content scripts display a refresh notice when their extension context expires.

## Try the workflow

Use synthetic data, such as `Write an email to Alice Tan at alice@example.com.`

1. Open **Word bank** and optionally save mappings with a passphrase of at least 12 characters.
2. Open **Composer**, choose a destination chat or the private workspace, and type the draft. Scanning starts automatically.
3. In **VoiceGuard**, review one finding at a time. Use **Replace**, **Keep**, **Undo**, **Redo**, and the explanation controls.
4. Choose **Approve Draft**. Nothing is sent. Copy or insert using the separate confirmation. Edits and rescans invalidate approval.
5. In a supported chat, **Show originals** displays known saved values; **Show placeholders** switches back. Choose the correct workspace in the popup when necessary.
6. Use **Private reader beside chat** when you want restored values kept outside the website DOM.

The inline review's **Accessible VoiceGuard review** opens the same guided experience. Legacy hover suggestions can also apply individual approved changes. The extension never clicks the website's Send button.

### Word bank behaviour

Mappings are scoped to each chat path, private composer, or document. Saved banks use AES-256-GCM, PBKDF2-SHA256, and fresh random salts/nonces. The unlock key is held only in service-worker memory. Restarting the worker locks a saved bank; temporary mappings can be lost. Sessions expire after eight hours. Expired/deleted mappings cannot reconstruct old originals. A new chat URL may require selecting the workspace used before its URL changed.

### Files

- **Replace sensitive text:** review UTF-8 TXT/CSV files up to 1 MB, approve, and download a protected copy. The source is unchanged. Replacing numeric cells can invalidate calculations.
- **Encrypt / Decrypt:** protect files of any format up to 10 MB. Encryption includes the filename and content. A lost passphrase cannot be recovered; ordinary AI tools cannot analyse the encrypted file.
- DOCX/PDF replacement export is not implemented. These formats can be encrypted as whole files.

### Voice and Gemini

Voice recognition starts only after an explicit click and requires supported on-device English recognition and a local language pack. It never silently falls back to a remote recognizer. Keyboard controls remain available. Optional speech output uses local voices only.

Gemini is optional and off by default. Configure `GEMINI_API_KEY` and `GEMINI_MODEL` on the backend, restart it, enable Gemini explanations in Settings, and approve the metadata disclosure within each review. The key never belongs in the extension or a commit. Local lessons remain available when Gemini is disabled or unavailable.

See [VoiceGuard setup and demonstration](docs/voiceguard.md) for configuration commands, voice compatibility, and validation limits.

## Development and verification

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, formatting, and tests. GitHub Actions runs extension formatting, unit tests, build, browser tests, Python lint/format checks, and backend tests.

The browser suite loads the real extension in isolated Chromium with synthetic website fixtures. Speech and provider responses are simulated only in labelled automated tests. Those tests do not certify current live website layouts, real microphone accuracy, live Gemini responses, or WCAG conformance.

## Privacy boundaries and current limitations

- A website may already observe anything typed in its editor. Use Secure Composer for confidential drafts.
- **On-page original-word mode exposes restored values to the website.** The extension-owned private reader provides a stronger separation.
- Detection can miss information or misclassify it. Placeholders do not guarantee anonymity; context can still identify someone.
- The extension does not block the host site's Send action. Approval controls apply to Pribruhty's own workflow.
- Word banks are scoped by chat path, not authenticated organization/account identity.
- Local malware, browser-profile compromise, screenshots, and clipboard exposure are outside this tool's protection.
- Real microphone, human accessibility, and live Gemini validation require the corresponding device, users, and credentials. Sponsor eligibility and deployment are not implied.

## Project structure

```text
backend/       FastAPI, Presidio/spaCy detection, metadata-only Gemini endpoint, tests
extension/     Chrome MV3 extension, React/TypeScript UI, VoiceGuard, browser tests
docs/          Architecture, security, setup, research, and sponsor documentation
test-data/     Clearly labelled synthetic demo data
```

Documentation: [architecture](docs/architecture.md) ? [security limits](docs/security.md) ? [related work](docs/similar-projects.md) ? [project description](docs/devpost.md) ? [Coder for Good](docs/sponsors/coder-for-good.md) ? [Gemini API](docs/sponsors/gemini-api.md).
