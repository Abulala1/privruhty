# Drag-to-chat attachment protection

## Requested behaviour and current status

The intended workflow is: drop a file on a supported chat, hold the original upload, scan locally, create a protected copy, then attach only that copy. The original disk file stays unchanged. This is different from downloading a protected file through Documents.

Privruhty currently implements local TXT/CSV sanitization and protected downloads. It does **not yet intercept files dropped onto ChatGPT, Claude, or Gemini**. The following is source-backed research and an implementation recommendation, not a claim that interception is already shipped. No third-party source was copied.

## Projects inspected

### Offsend: closest match for actual replacement

- Repository: <https://github.com/Offsend/browser-extension>
- Attachment handling: <https://github.com/Offsend/browser-extension/blob/main/src/core/adapters/shared/file-attach.ts>
- File transformation: <https://github.com/Offsend/browser-extension/blob/main/src/core/interceptor/files.ts>

Its attachment handler captures file-input changes, drops, and pasted files. It stops the original event synchronously before awaiting a decision. A reentrancy flag prevents its own replay from being intercepted again. Replacement content becomes a new browser `File`; the source disk file is not edited.

For replay, it finds a compatible file input, builds a `DataTransfer`, assigns its file list, and dispatches input/change events. It prefers this route over replaying the original drop because chat overlays can disappear during asynchronous scanning and sites may depend on active drag state. It has a replay-target fallback and resets drag overlays.

Its masking path handles text-like files. Its Office/PDF extraction path explicitly marks those files non-maskable: extracting and detecting text is not the same as writing a sanitized Office/PDF binary. Unknown and oversized files receive coverage status rather than a claim of protection. Its current size/policy choices should not be adopted as universal guarantees.

### AI-Guardrails: hold, scan, review, allow or cancel

- Repository: <https://github.com/mcgraser/AI-Guardrails>
- Interception: <https://github.com/mcgraser/AI-Guardrails/blob/main/src/content/file-upload-interceptor.ts>
- Coverage UI: <https://github.com/mcgraser/AI-Guardrails/blob/main/src/content/file-scan-review.ts>

It registers capture-phase listeners on window for input/change, drop, and paste. A weak set distinguishes released events from new uploads. Pending file-input selections are tracked so input/change pairs do not produce duplicate scans and changed selections supersede old scans. It holds supported documents during extraction/detection and asks whether to release them. The inspected release path forwards the held files; it is a useful interception/review reference, not evidence of automatic Office/PDF rewriting. Unreadable, truncated, image-only, and oversized documents have explicit status messages.

### DnD Anywhere: upload hand-off reference

- Repository: <https://github.com/rjach/dnd-anywhere>
- Injector: <https://github.com/rjach/dnd-anywhere/blob/main/extension/src/core/injector.ts>
- Architecture: <https://github.com/rjach/dnd-anywhere/blob/main/docs/architecture.md>

It locates upload controls and supplies files through `DataTransfer` plus bubbling input/change events. Site adapters and a page-world capture shim support controls that create a file input only when clicked. It is not a sanitizer. It documents trusted-event, file-picker, folder, and site-compatibility limits.

## Recommended Privruhty design

1. Install a small early attachment guard on supported hosts, before asynchronous scanning. Capture files synchronously inside the drop/paste event because `DataTransfer.files` is protected outside those events. Prevent the original event from reaching ordinary site upload handlers while a decision is pending.
2. Reuse `parseDocument`, the existing service-worker scan/mapping pipeline, and `exportDocument`. Start with the existing verified UTF-8 TXT/CSV formats and 1 MB bound. Keep mappings in the destination chat workspace so replies can restore their placeholders.
3. Support a review-first default and an explicit Auto-protect setting for supported files. That setting authorizes automatic masking/attachment; exact-value/manual-review policies must still stop unsafe transformations. Show a persistent scanning/protection result, a cancel action, and meaningful failure messages.
4. Create a new in-memory protected `File` with an appropriate filename and MIME type. Do not overwrite the original disk file, and do not send the original to Gemini. A protected filename must not leak a sensitive original filename.
5. Deliver the approved copy to the site's compatible upload input with `DataTransfer` and input/change events. Use host adapters to identify the correct composer/input and handle replaced DOM nodes. Add a loop guard and handle both input/change events so only one upload occurs.
6. If the site rejects scripted attachment, offer a protected download and explicit reattachment. Do not silently release the original when scanning, policy, or replay fails. Unknown formats must not be labelled protected.
7. Cover file-picker, drop, and pasted-file routes together. Do not interfere with ordinary text pastes. Support cancellation, multiple files, stale scans, navigation, locked banks, and extension invalidation.
8. Test that the synthetic website receives only protected bytes and that original sentinel strings never reach its upload requests. Also test CSV validity, filename masking, duplicate events, unsupported formats, scan failure, locked mappings, cancel, and rejected replay. Synthetic events are not trusted events, so fixtures alone do not prove live-site compatibility.

PDF/DOCX/image redaction is a separate phase. Safe rewriting must account for hidden text, metadata, document parts, annotations, embedded objects, and images. Plain-text extraction or painting a black rectangle over a PDF is not proof that sensitive bytes were removed. Encrypted files are not a replacement when the AI needs readable content.

## Boundaries

An AI service may upload a file as soon as it is attached, before the chat message is sent. Protection therefore needs to happen before hand-off to the site. Browser/event ordering and site behaviour prevent a universal guarantee against a page that reads the original through another route. Early listeners, tested host adapters, and a download fallback provide a practical compatibility strategy; the extension-owned Documents workflow remains a separate option.

Browser references: [DataTransfer.files](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files), [Chrome content scripts and run timing](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## Branding compatibility

The product name is **Privruhty**. Legacy internal token/header names, DOM identifiers, `.pribruhty` encrypted-file extensions, and version-1 cryptographic authenticated-data labels remain unchanged so existing settings, encrypted banks, and encrypted files continue to work. These are compatibility details, not the public product name.
