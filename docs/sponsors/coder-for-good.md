# Coder for Good: VoiceGuard

## Purpose and design

Pribruhty helps users make privacy decisions before using AI. Optional hands-free review addresses motor access needs. Easy Understand Mode offers short explanations, one item at a time, progress, repeat, and previous controls without decision time limits. Users choose preferences; no disability diagnosis is inferred.

Composer, document review, and the inline panel share the existing detector, mappings, and VoiceGuard review component. Fixed local voice commands navigate, explain, replace, keep, undo/redo, approve, and cancel. A model never executes commands. Speech requires on-device recognition with no cloud fallback. Keyboard controls remain available.

The interface includes named controls, semantic headings, progress labels, polite status messages, focus indicators, keyboard navigation, high contrast, and adjustable font size. Approval cannot send a message. Explicit confirmation is required for copying/inserting externally.

## Testing and honest evidence

See `extension/src/voiceguard.test.ts`, `extension/src/speech.test.ts`, and VoiceGuard browser cases in `extension/e2e/extension.spec.ts`. Browser tests exercise keyboard events, focus, labels, large text, contrast, document export, and separate insertion confirmation. Speech recognition uses an explicitly synthetic double in automation, not a microphone-accuracy claim. Screenshot: `extension/test-results/voiceguard-high-contrast.png`.

WCAG 2.2 AA is a target, not a certification. A real screen-reader walkthrough and feedback from users with access needs remain outstanding. References: [W3C status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages), [accessibility checks](https://www.w3.org/WAI/test-evaluate/preliminary/).

No Coder workspace has been provisioned or used. If the event requires it, develop/test in that workspace and include verifiable evidence before claiming qualification. Organizer rules determine eligibility and multi-track participation. Follow the [setup and demo](../voiceguard.md); clearly distinguish simulated speech from a real live demonstration.
