# Privruhty

**Accessible privacy protection for AI conversations.**

## Inspiration

AI tools like ChatGPT, Claude, and Gemini have become part of our daily lives. However, many people accidentally share sensitive information, such as their names, emails, passwords, financial records, or private documents, without realizing the risks.

We wanted to create something like Grammarly, but instead of correcting grammar, it protects your privacy when using AI.

We also realized that cybersecurity tools are not always accessible to everyone. People with motor disabilities may struggle with a mouse or keyboard, while people with cognitive disabilities may find security warnings difficult to understand.

This inspired us to build **Privruhty**, an AI privacy assistant that not only protects sensitive information but also helps users understand why their privacy matters.

## What it does

Privruhty is a browser extension that detects and protects sensitive information before users share it with AI platforms.

It offers several key features:

- **Live Chat Protection:** Automatically detects sensitive information while users type in AI chatboxes. Like Grammarly, it highlights private information and suggests safer replacements.
- **Secure Composer:** Allows users to write and review private prompts in a protected editor before inserting them into an AI website.
- **Smart Replacement:** Replaces sensitive information with consistent placeholders, such as `Alice Tan → PERSON_1`, while preserving useful context.
- **Encrypted Word Bank:** Stores original information locally with optional AES-GCM encryption, allowing users to restore known placeholders when needed.
- **Document Protection:** Detects sensitive information in TXT and CSV files and creates sanitized copies. It also supports whole-file encryption for private storage.
- **VoiceGuard:** Lets users review privacy warnings through voice commands such as "Explain this," "Replace it," "Keep it," and "Undo."
- **Easy Understand Mode:** Provides simple explanations, accessible controls, high contrast, and adjustable text size.
- **Gemini Cybersecurity Assistant:** Designed to explain why information is sensitive, what risks it creates, and how to protect it, using only explicitly approved category and task metadata.

Users can review suggested changes, and Privruhty never automatically submits their messages. Attachment Auto-protect can attach checked copies automatically; users can choose review-before-attaching in Settings. Websites may upload files as soon as they are attached.

## How we built it

We built Privruhty using a combination of browser extension development, natural language processing, encryption, and accessible interface design.

- **TypeScript and React:** Used to develop the Chrome extension, Grammarly-style interface, privacy review panel, and Secure Composer.
- **Python and FastAPI:** Power the local backend for sensitive-information detection and processing.
- **Microsoft Presidio and spaCy:** Identify personal information such as names, organizations, and locations.
- **Regular Expressions:** Detect structured data such as emails, phone numbers, credit cards, and common API credentials.
- **AES-GCM Encryption:** Protects locally stored replacement mappings and encrypted files.
- **Browser Speech APIs:** Provide voice commands and spoken explanations when supported on the user's device.
- **Google Gemini API:** Provides an optional integration for simple cybersecurity explanations based on approved metadata, without receiving the original sensitive information.
- **Vultr:** Added a Docker Compose deployment setup for running the detection backend on Vultr behind HTTPS, with two preloaded detector workers. Cloud detection is optional and requires consent to send original scanned text to the configured server. Word-bank encryption and restoration remain in the extension.

We focused on local processing by default, explicit consent for optional cloud features, and a protection process that is simple and easy to use.

## Challenges we ran into

One of our biggest challenges was **protecting sensitive information without changing the meaning of the user's request**.

For example, replacing someone's name with `PERSON_1` usually works well when writing an email. However, replacing a salary with `AMOUNT_1` could prevent the AI from correctly calculating a total or comparing financial information.

Another challenge was integrating our privacy assistant into AI websites. Their chatboxes use different structures, so we needed to make sure our suggestions and review panel worked without interfering with normal typing.

We also faced challenges with reversible placeholders. We wanted users to restore their original words locally without accidentally exposing those words to the external AI website.

Accessibility introduced additional challenges. Voice recognition is not always processed locally, so we designed VoiceGuard to avoid silently switching to cloud recognition. We also made sure users could navigate the privacy review without relying on voice commands.

We also considered how to integrate cloud infrastructure with clear privacy boundaries. Local detection remains the default. The optional Vultr deployment moves detection to a user-configured HTTPS server, so the interface explicitly explains that original scanned text leaves the device in cloud mode. No live deployment or speed improvement has been verified.

Finally, we needed to balance strong security features with a simple interface that users without technical knowledge could understand.

## Accomplishments that we're proud of

We are proud that Privruhty is more than just a concept. We built and tested a working privacy assistant with several connected features.

Our biggest accomplishments include:

- Developing a Grammarly-style privacy protection interface for AI chatboxes.
- Building automatic sensitive-information detection using local rules and NLP.
- Creating a Secure Composer that lets users review information before sharing it.
- Implementing reversible placeholders and an encrypted local word bank.
- Adding document sanitization and whole-file encryption.
- Building VoiceGuard with voice-command support and accessible review controls.
- Creating Easy Understand Mode to make cybersecurity warnings easier to understand.
- Designing Gemini-assisted cybersecurity education without sharing original private information.
- Implementing optional cloud-detector settings and a Vultr deployment configuration with HTTPS, authentication, and explicit consent for remote scanning.

We are especially proud of combining **cybersecurity and accessibility** in one project. Privruhty helps users protect their information while teaching them how to make safer decisions online.

## What we learned

We learned that privacy protection is not as simple as replacing names, emails, or numbers.

Different types of information require different protection strategies. Removing too much information can make an AI response incorrect, while removing too little may still expose confidential details.

We also learned that privacy has to be considered throughout the entire application. Even displaying restored information on an external website can introduce risks, which is why we developed an extension-owned private reading option.

Another important lesson was that **security only works when people can understand and use it**.

By developing VoiceGuard and Easy Understand Mode, we saw how accessible design can help make cybersecurity more practical for everyone.

We also learned that cloud infrastructure needs a carefully defined role in privacy-focused applications. Public security services can be hosted externally, while remote detection requires users to trust their configured server and understand what data it receives.

## What's next for Privruhty

Our next goal is to make Privruhty more reliable, accessible, and useful across different AI platforms.

We plan to:

- Improve sensitive-information detection and reduce false positives.
- Expand support for additional document formats, including PDF and DOCX.
- Improve context-aware replacements for numbers, dates, and financial information.
- Complete live testing of the Gemini cybersecurity assistant.
- Test VoiceGuard with real users and different accessibility needs.
- Expand compatibility with more AI websites and browsers.
- Deploy and benchmark the Vultr detection backend, and explore a separate public privacy-rule update service.
- Develop stronger privacy protections for confidential business information.
- Evaluate how well Privruhty prevents information leakage while preserving AI answer quality.

In the future, we hope Privruhty can become a universal privacy assistant that works across AI websites and applications.

**Our goal is simple: Make AI safer and more accessible for everyone.**

---

## Run the project

Requirements: desktop Chrome, Node.js 22.20+ within the supported range in `extension/package.json`, and Python 3.11 or 3.12. From a cloned repository, run in Windows PowerShell:

```powershell
py -3.11 -m venv backend/.venv
& ./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
& ./backend/.venv/Scripts/python.exe -m spacy download en_core_web_sm
& ./backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8765
```

Leave that terminal running. In another terminal at the repository root:

```powershell
Set-Location extension
npm ci
npm run build
```

Enable Developer mode at `chrome://extensions` and load the repository's `extension/dist` folder. In Privruhty Settings, enter the token created at `%USERPROFILE%/.pribruhty-token`, save, and test the connection. The legacy token filename is retained for compatibility. Refresh chat tabs after reloading the extension. See [CONTRIBUTING.md](CONTRIBUTING.md) for development and tests.

Use [attachment-test.txt](test-data/attachment-test.txt) for a synthetic file demo. Automatic attachment replacement supports UTF-8 TXT/CSV up to 1 MB each, five files per batch. PDF/DOCX replacement is future work; whole-file encryption supports files up to 10 MB.

## Integration and validation status

The current version passes **32 extension unit tests, 12 backend tests, and 13 Chromium integration tests**. Browser tests use isolated synthetic chat pages; speech and provider responses are simulated in labelled tests. Live Gemini usage, Vultr deployment, real microphone accuracy, and human accessibility validation remain to be verified.

Gemini is optional and requires backend credentials and per-review metadata consent. Vultr deployment files are included; cloud scanning requires an HTTPS server, a token, and explicit consent to send original text. Credentials are not bundled in this repository.

The on-page original-word switch exposes restored values to the website. Use the extension-owned private reader for stronger separation. Detection may miss information; use Secure Composer for confidential drafts because websites can observe text entered in their editors.

[Architecture](docs/architecture.md) | [Security](docs/security.md) | [VoiceGuard setup](docs/voiceguard.md) | [Gemini](docs/sponsors/gemini-api.md) | [Vultr](docs/sponsors/vultr.md)
