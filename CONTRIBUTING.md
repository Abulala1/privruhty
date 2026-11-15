# Development

Use Node.js 22.20+ or a supported newer LTS, Python 3.11/3.12, and synthetic data. Follow the runtime setup in [README.md](README.md).

## Extension

From `extension`:

```powershell
npm ci
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run format` formats extension source/configuration, root Markdown, documentation, and CI configuration. `npm run format:check` verifies the same files. Generated bundles, caches, browser reports, and lockfiles are excluded from formatting.

Reload the unpacked extension at `chrome://extensions` and refresh chat tabs after builds. Browser tests use temporary profiles and synthetic pages; they do not alter your regular browser profile. Do not run two browser-test processes in the same checkout because they share the report directory.

## Backend

From the repository root, install development tools:

```powershell
& ./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
```

Then from `backend`:

```powershell
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m ruff format --check .
./.venv/Scripts/python.exe -m pytest -q
```

Use `ruff format .` to format Python code. Install `en_core_web_sm` as described in the README to exercise automatic-name detection tests. On Linux/macOS, virtual-environment executables are in `.venv/bin/`.

## Privacy and changes

- Do not commit API keys, the local-service token, original drafts/documents, mappings, recordings, or browser profiles. `.env` files are ignored and are not loaded automatically.
- Gemini education accepts enum metadata only. Do not add free-form prompts or raw transcripts to that endpoint.
- Voice commands must remain an explicit allowlist; models must not execute actions or override local policy.
- Keep draft approval separate from external insertion/submission. Preserve credential removal and approval invalidation after edits.
- Use keyboard-accessible controls and text status messages. Automated tests are not a replacement for real assistive-technology testing.
- Run relevant tests after functional changes. Keep documentation accurate about mocked tests versus live integrations.

No third-party source code has been copied into this project. Related implementations are linked in [docs/similar-projects.md](docs/similar-projects.md).
