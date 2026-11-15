# Pribruhty: accessible privacy protection for AI

Pribruhty helps people review sensitive information before sharing prompts and documents with AI services. Its Chrome extension combines Grammarly-style highlights, a Secure Composer, an encrypted local word bank, reversible placeholders, and document protection.

## How it works

Pattern checks detect common structured identifiers and credentials. A local FastAPI backend adds Microsoft Presidio and spaCy for contextual entities such as names. Users review suggestions and choose what to replace. Consistent per-workspace placeholders preserve references without sending original identifiers through the extension's optional education API.

A private reader restores saved originals inside the extension. A separate opt-in page switch displays originals directly in conversations and streaming replies. That page mode deliberately exposes restored values to the website and is clearly distinguished from the private reader.

TXT/CSV files can be scanned, reviewed, and exported as protected copies. Any file up to 10 MB can instead be encrypted for private storage using passphrase-based AES-GCM. An encrypted file is not AI-readable.

## VoiceGuard and inclusive review

VoiceGuard shares the existing review pipeline across Composer, documents, and the inline panel. A deterministic command allowlist supports navigation, explanations, replacement, keep, undo/redo, approval, and cancellation. Recognition requires supported on-device processing; there is no remote speech fallback. Keyboard controls remain available.

Easy Understand Mode presents one finding at a time with simple explanations, progress, repeat controls, high contrast, adjustable text, visible focus, and screen-reader status announcements. Approval never sends a message; copying or inserting requires a separate confirmation.

## Gemini cybersecurity education

Optional Gemini explanations receive only consented category, task, strategy, explanation-level, and topic enum values through the local backend. Original drafts, documents, mappings, audio, and transcripts are excluded. Structured output is validated, local policy retains authority, and prewritten lessons provide a fallback. The API key stays outside the extension.

## Technology and validation

TypeScript, React, Chrome Manifest V3, Web Crypto, FastAPI, Presidio, spaCy, and the Gemini REST API. Unit, backend, and isolated Chromium tests cover policy, privacy boundaries, encryption, accessible review, and simulated speech/provider behaviour.

Real microphone accuracy, human screen-reader validation, and a live Gemini demonstration require the corresponding device, users, and credentials. Sponsor qualification and cloud deployment are not claimed. See the sponsor documents for evidence still needed.

## What we learned

Privacy protection must preserve useful meaning without promising anonymity. Detection can miss context, replacing exact numbers can invalidate calculations, and sites may observe text typed in their editors. Accessible controls and clear explanations help users make informed decisions about those tradeoffs.
