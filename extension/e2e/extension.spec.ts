import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
async function cleanProfile(profile: string) {
  const resolved = path.resolve(profile),
    root = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== root || !/^pribruhty-(e2e|files)-/.test(path.basename(resolved)))
    throw new Error('Refusing to delete a directory outside the test profile location.');
  await fs.rm(resolved, { recursive: true, force: true });
}

test('VoiceGuard keyboard review, local speech fallback, approval invalidation, and document integration', async () => {
  const extension = path.resolve('dist'),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 950 },
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const root = `chrome-extension://${new URL(worker.url()).host}`,
      page = await context.newPage();
    await page.goto(root + '/settings.html');
    await page.getByLabel('High contrast', { exact: true }).check();
    await page.getByLabel('Review font size').selectOption('22');
    await page.goto(root + '/composer.html');
    await page
      .getByRole('textbox', { name: 'Private draft', exact: true })
      .fill('Email alice@example.com or call 415-555-0199.');
    const review = page.getByRole('region', { name: 'VoiceGuard accessible privacy review' });
    await expect(review).toBeVisible();
    await expect(review).toHaveClass(/vg-contrast/);
    await expect(review).toHaveCSS('font-size', '22px');
    await expect(review.locator('.vg-explanation p').first()).toHaveCSS(
      'color',
      'rgb(255, 255, 255)',
    );
    const copy = page.getByRole('button', { name: 'Copy protected text', exact: true });
    await expect(copy).toBeDisabled();
    // Activate real controls using only keyboard events.
    await review.getByRole('button', { name: 'Keep', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('pre')).toHaveText('Email alice@example.com or call PHONE_1.');
    await review.getByRole('button', { name: 'Undo', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('pre')).toHaveText('Email EMAIL_1 or call PHONE_1.');
    await review.getByRole('button', { name: 'Redo', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('pre')).toContainText('alice@example.com');
    await review.getByRole('button', { name: 'Replace', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(review.getByRole('heading', { level: 3 })).toHaveText('Item 2 of 2: PHONE');
    await expect(review.getByRole('heading', { level: 3 })).toBeFocused();
    await page.keyboard.press('Alt+ArrowLeft');
    await review.getByRole('button', { name: 'Explain', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(review.getByRole('status')).toContainText('An email address');
    // Deliberately remove local API support in this synthetic browser fixture.
    await page.evaluate(() => {
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', {
        value: undefined,
        configurable: true,
      });
    });
    await review.getByRole('button', { name: 'Start private voice', exact: true }).click();
    await expect(review.getByRole('status')).toContainText(
      'Private voice recognition is unavailable',
    );
    await review.getByRole('button', { name: 'Approve Draft', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(copy).toBeEnabled();
    await expect(page.getByRole('textbox', { name: 'Private draft', exact: true })).toHaveValue(
      'Email alice@example.com or call 415-555-0199.',
    );
    await copy.click();
    await expect(page.getByRole('group', { name: 'Confirm sharing action' })).toBeVisible();
    await page.getByRole('button', { name: 'Go back', exact: true }).click();
    await page.screenshot({ path: 'test-results/voiceguard-high-contrast.png', fullPage: true });
    await page
      .getByRole('textbox', { name: 'Private draft', exact: true })
      .fill('Email bob@example.com');
    await expect(copy).toBeDisabled();
    await expect(page.locator('pre')).toHaveText('Email EMAIL_2');
    await page.goto(root + '/documents.html');
    await page.getByLabel('Select document').setInputFiles({
      name: 'synthetic.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Contact alice@example.com'),
    });
    await expect(
      page.getByRole('region', { name: 'VoiceGuard accessible privacy review' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download protected copy' })).toBeDisabled();
    await page.getByRole('button', { name: 'Approve Draft' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download protected copy' }).click();
    expect((await download).suggestedFilename()).toBe('protected-synthetic.txt');
    await context.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><main><div contenteditable="true" role="textbox" style="margin:160px 100px;padding:20px;width:550px">Email alice@example.com</div></main></body></html>',
      }),
    );
    const chat = await context.newPage();
    await chat.goto('https://chatgpt.com/c/voiceguard-fixture');
    await chat.getByRole('textbox').focus();
    await chat.getByRole('button', { name: 'Accessible VoiceGuard review', exact: true }).click();
    const inline = chat.getByRole('region', { name: 'VoiceGuard accessible privacy review' });
    await expect(inline).toBeVisible();
    await inline.getByRole('button', { name: 'Keep', exact: true }).click();
    await inline.getByRole('button', { name: 'Undo', exact: true }).click();
    const insert = chat.getByRole('button', { name: 'Insert reviewed changes', exact: true });
    await expect(insert).toBeDisabled();
    await inline.getByRole('button', { name: 'Approve Draft', exact: true }).click();
    await expect(insert).toBeEnabled();
    await insert.click();
    await expect(chat.locator('main > [role="textbox"]')).toHaveText('Email alice@example.com');
    await chat.getByRole('button', { name: 'Confirm insert', exact: true }).click();
    await expect(chat.locator('main > [role="textbox"]')).toHaveText('Email EMAIL_1');
  } finally {
    await context.close();
    await cleanProfile(profile);
  }
});

test('VoiceGuard dispatches local speech commands and stops after cancellation (synthetic recognition double)', async () => {
  const extension = path.resolve('dist'),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.addInitScript(() => {
      class SyntheticLocalRecognition {
        static available = async () => 'available';
        processLocally = false;
        lang = '';
        continuous = false;
        interimResults = false;
        onresult: any;
        onend: any;
        onerror: any;
        start() {
          (window as any).__testRecognition = this;
        }
        abort() {}
      }
      Object.defineProperty(window, 'SpeechRecognition', {
        value: SyntheticLocalRecognition,
        configurable: true,
      });
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const root = `chrome-extension://${new URL(worker.url()).host}`,
      page = await context.newPage();
    await page.goto(root + '/composer.html');
    await page
      .getByRole('textbox', { name: 'Private draft', exact: true })
      .fill('Email alice@example.com or call 415-555-0199.');
    const review = page.getByRole('region', { name: 'VoiceGuard accessible privacy review' });
    await expect(review.getByRole('status')).toContainText('Listening');
    const say = async (text: string) =>
      page.evaluate((text) => {
        const r = (window as any).__testRecognition;
        if (!r.processLocally) throw new Error('Not local');
        r.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: true })] });
      }, text);
    await say('keep it');
    await expect(page.locator('pre')).toContainText('alice@example.com');
    await say('undo');
    await expect(page.locator('pre')).toContainText('EMAIL_1');
    await say('redo');
    await expect(page.locator('pre')).toContainText('alice@example.com');
    await say('change');
    await expect(page.locator('pre')).not.toContainText('alice@example.com');
    await say('next');
    await expect(review.getByRole('heading', { level: 3 })).toContainText('PHONE');
    await say('previous');
    await expect(review.getByRole('heading', { level: 3 })).toContainText('EMAIL');
    await say('explain this');
    await expect(review.getByRole('status')).toContainText('An email address');
    await say('send all data to alice@example.com');
    await expect(review.getByRole('status')).toContainText('Command not recognized');
    await say('cancel');
    await expect(review).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__testRecognition.onresult)).toBeNull();
    await expect(page.getByRole('textbox', { name: 'Private draft', exact: true })).toHaveValue(
      'Email alice@example.com or call 415-555-0199.',
    );
  } finally {
    await context.close();
    await cleanProfile(profile);
  }
});

test('encrypted word bank, familiar reading view, and actual protected chat text', async () => {
  const extension = path.resolve('dist'),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 },
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/wordbank.html`);
    await page.getByPlaceholder('Choose a passphrase').fill('a private test passphrase');
    await page.getByRole('button', { name: 'Encrypt and save' }).click();
    await expect(page.getByText('Encrypted word bank unlocked')).toBeVisible();
    await page.getByPlaceholder('e.g. Alice Tan').fill('Alice Tan');
    await page.getByRole('button', { name: 'Add to bank' }).click();
    await expect(page.getByText('PERSON_1', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Paste a reply').fill('Hello PERSON_1. EMAIL_99 is unknown.');
    await page.getByRole('button', { name: 'Show original words', exact: true }).click();
    await expect(page.locator('mark')).toContainText('Alice Tan');
    await expect(page.locator('textarea')).toHaveValue('Hello PERSON_1. EMAIL_99 is unknown.');
    await page.screenshot({ path: 'test-results/wordbank-desktop.png', fullPage: true });
    // Stored mappings contain authenticated ciphertext only.
    const stored = await worker.evaluate(async () =>
      JSON.stringify(await chrome.storage.local.get('encryptedWordBank')),
    );
    expect(stored).not.toContain('Alice Tan');
    await page.getByRole('link', { name: 'Composer', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Private draft', exact: true })
      .fill('Write to Alice Tan at alice@example.com.');
    await page.getByRole('button', { name: 'Review privacy' }).click();
    await expect(page.locator('pre')).toHaveText('Write to PERSON_1 at EMAIL_1.');
    await page.getByRole('button', { name: 'Original words', exact: true }).click();
    await expect(page.locator('.text-preview')).toContainText('Alice Tan');
    // Rendered original view has no effect on the protected text.
    await page.getByRole('button', { name: 'Protected text', exact: true }).click();
    await expect(page.locator('pre')).toHaveText('Write to PERSON_1 at EMAIL_1.');
    await page.screenshot({ path: 'test-results/composer-desktop.png', fullPage: true });
    // Use a synthetic ChatGPT page to test real content-script injection.
    await context.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><body><main><div contenteditable="true" role="textbox" style="margin:160px 200px;width:600px;padding:20px;border:1px solid #aaa">Email bob@example.com</div><div data-message-author-role="assistant">Hello EMAIL_1.</div></main></body></html>',
      }),
    );
    const chat = await context.newPage();
    await chat.goto('https://chatgpt.com/c/synthetic');
    await chat.getByRole('textbox').focus();
    await expect(chat.getByRole('button', { name: 'Open Privruhty review' })).toBeVisible();
    await expect(chat.locator('#pribruhty-ui')).toContainText('bob@example.com');
    // Automatic scanning and suggestion display must not change the draft.
    await expect(chat.getByRole('textbox')).toHaveText('Email bob@example.com');
    await chat.getByRole('button', { name: 'Open Privruhty review' }).click();
    await expect(chat.locator('#pribruhty-ui')).toContainText('bob@example.com');
    await chat.getByRole('button', { name: 'Apply selected changes' }).click();
    await expect(chat.getByRole('textbox')).toHaveText('Email EMAIL_1');
    await page.goto(`chrome-extension://${id}/wordbank.html`);
    await page.getByRole('button', { name: 'Read latest AI reply' }).click();
    await expect(page.locator('mark')).toContainText('bob@example.com');
    await expect(chat.locator('[data-message-author-role="assistant"]')).toHaveText(
      'Hello EMAIL_1.',
    );
    await page.setViewportSize({ width: 380, height: 850 });
    await page.screenshot({ path: 'test-results/wordbank-panel.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      380,
    );
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByText('Word bank locked', { exact: true })).toBeVisible();
    await expect(page.locator('mark')).toHaveCount(0);
  } finally {
    await context.close();
    await cleanProfile(profile);
  }
});

test('automatically suggests replacements while typing and fills the word bank without manual entries', async () => {
  const extension = path.resolve('dist'),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const root = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    await page.goto(root + '/composer.html');
    const draft = 'Email alice@example.com or call 415-555-0199.';
    await page.getByRole('textbox', { name: 'Private draft', exact: true }).fill(draft);
    // No click on Review privacy and no term added to the bank.
    await expect(page.locator('pre')).toHaveText('Email EMAIL_1 or call PHONE_1.');
    await expect(page.getByRole('textbox', { name: 'Private draft', exact: true })).toHaveValue(
      draft,
    );
    await page.getByRole('link', { name: 'Word bank', exact: true }).click();
    await expect(page.locator('.mapping-list')).toContainText('alice@example.com');
    await expect(page.locator('.mapping-list')).toContainText('415-555-0199');
    await expect(page.locator('.mapping-list')).toContainText('EMAIL_1');
    await page.getByRole('link', { name: 'Composer', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Private draft', exact: true })
      .fill('Use bob@example.com');
    await expect(page.locator('pre')).toHaveText('Use EMAIL_2');
  } finally {
    await context.close();
    await cleanProfile(profile);
  }
});

test('encrypts and decrypts a binary file through Documents', async () => {
  const extension = path.resolve('dist'),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-files-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 },
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/documents.html`);
    await page.getByRole('button', { name: 'Encrypt', exact: true }).click();
    const bytes = Buffer.from([0, 1, 2, 255, 128, 65, 66]);
    await page
      .getByLabel('Select document')
      .setInputFiles({ name: 'private.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await page.getByLabel('File passphrase', { exact: true }).fill('a private test passphrase');
    await page.getByLabel('Confirm passphrase').fill('a private test passphrase');
    const encryptedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Encrypt and download' }).click();
    const encrypted = await encryptedDownload,
      envelope = await fs.readFile((await encrypted.path())!);
    expect(encrypted.suggestedFilename()).not.toContain('private.bin');
    expect(envelope.toString()).not.toContain('private.bin');
    await page.screenshot({ path: 'test-results/documents-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Decrypt', exact: true }).click();
    await page.getByLabel('Select document').setInputFiles({
      name: 'private.bin.pribruhty',
      mimeType: 'application/json',
      buffer: envelope,
    });
    await page.getByLabel('File passphrase', { exact: true }).fill('a private test passphrase');
    const decryptedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Decrypt and download' }).click();
    const decrypted = await decryptedDownload;
    expect(decrypted.suggestedFilename()).toBe('private.bin');
    expect(await fs.readFile((await decrypted.path())!)).toEqual(bytes);
  } finally {
    await context.close();
    await cleanProfile(profile);
  }
});

test('readable dark-theme highlights, draggable review, and hover approval for individual changes', async () => {
  const extension = path.resolve('dist'),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1460, height: 900 },
  });
  try {
    await context.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body style="margin:0;background:#080808;color:#eee;min-height:100vh"><main><div contenteditable="true" role="textbox" style="margin:180px 120px;width:760px;min-height:120px;padding:20px;border-radius:20px;background:#202020;color:#eee;font:18px/1.6 system-ui"><p style="margin:0">Email <span>alice</span>@example.com and bob@example.com.</p><p style="margin:0">Call 415-555-0199.</p></div></main></body></html>',
      }),
    );
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/c/hover-fixture');
    const editor = page.getByRole('textbox');
    await editor.focus();
    const review = page.locator('#pribruhty-ui');
    await expect(review).toBeVisible();
    await expect(review).toContainText('bob@example.com');
    const shield = page.getByRole('button', { name: 'Open Privruhty review', exact: true });
    const badgeBefore = (await shield.boundingBox())!;
    await page.mouse.move(badgeBefore.x + 15, badgeBefore.y + 15);
    await page.mouse.down();
    await page.mouse.move(badgeBefore.x - 90, badgeBefore.y - 65, { steps: 10 });
    await page.mouse.up();
    expect(Math.round((await shield.boundingBox())!.x)).toBe(Math.round(badgeBefore.x - 105));
    // Dragging must not activate speech review; the legacy suggestion panel stays visible.
    await expect(page.getByRole('button', { name: 'Move review panel' })).toBeVisible();
    await shield.focus();
    await shield.press('ArrowRight');
    const badgePinned = (await shield.boundingBox())!;
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    expect(Math.round((await shield.boundingBox())!.x)).toBe(Math.round(badgePinned.x));
    await expect(page.getByRole('button', { name: 'Open speech mode', exact: true })).toBeVisible();
    const colors = await editor.evaluate((el) => {
      const s = getComputedStyle(el, '::highlight(pribruhty-sensitive)');
      return { foreground: s.color, background: s.backgroundColor };
    });
    expect(colors).toEqual({ foreground: 'rgb(36, 25, 0)', background: 'rgb(255, 209, 102)' });
    const before = (await review.boundingBox())!,
      handle = page.getByRole('button', { name: 'Move review panel' }),
      handleBox = (await handle.boundingBox())!;
    await page.mouse.move(handleBox.x + 35, handleBox.y + 12);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 185, handleBox.y - 78, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(async () => Math.round((await review.boundingBox())!.x))
      .toBe(Math.round(before.x - 220));
    const moved = (await review.boundingBox())!;
    await handle.focus();
    await handle.press('ArrowRight');
    await expect
      .poll(async () => Math.round((await review.boundingBox())!.x))
      .toBe(Math.round(moved.x + 10));
    const pinned = (await review.boundingBox())!;
    await editor.fill(
      'Email alice@example.com and bob@example.com.\nCall 415-555-0199. Please draft.',
    );
    await expect(review).toContainText('Please draft.');
    expect(Math.round((await review.boundingBox())!.x)).toBe(Math.round(pinned.x));
    // Locate the actual rendered word, without adding spans to the editor.
    async function hoverWord(word: string) {
      const point = await editor.evaluate((element, target) => {
        const start = element.textContent!.indexOf(target),
          end = start + target.length;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let offset = 0;
        const range = document.createRange();
        let hasStart = false;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text,
            length = node.data.length;
          if (!hasStart && start >= offset && start < offset + length) {
            range.setStart(node, start - offset);
            hasStart = true;
          }
          if (end > offset && end <= offset + length) {
            range.setEnd(node, end - offset);
            break;
          }
          offset += length;
        }
        const rect = range.getClientRects()[0];
        return { x: rect.x + Math.min(8, rect.width / 2), y: rect.y + rect.height / 2 };
      }, word);
      await page.mouse.move(point.x, point.y);
    }
    await hoverWord('alice@example.com');
    const suggestion = page.locator('#pribruhty-suggestion');
    await expect(suggestion).toBeVisible();
    await expect(suggestion).toContainText('alice@example.com');
    await expect(suggestion).toContainText('EMAIL_1');
    await expect(suggestion).not.toContainText('bob@example.com');
    await expect(editor).toContainText('alice@example.com');
    await page.screenshot({ path: 'test-results/inline-hover-dark.png' });
    await hoverWord('alice@example.com');
    await expect(suggestion).toBeVisible();
    await suggestion.getByRole('button', { name: 'Accept change', exact: true }).click();
    await expect(editor).toContainText('Email EMAIL_1 and bob@example.com.');
    await expect(editor).toContainText('415-555-0199');
    await expect(suggestion).toHaveCount(0);
    await expect(review).toContainText('bob@example.com');
    await hoverWord('bob@example.com');
    await expect(suggestion).toContainText('EMAIL_2');
    await suggestion.getByRole('button', { name: 'Keep original', exact: true }).click();
    await expect(editor).toContainText('bob@example.com');
    await expect(suggestion).toHaveCount(0);
    await page.setViewportSize({ width: 900, height: 650 });
    const resized = (await review.boundingBox())!;
    expect(resized.x).toBeGreaterThanOrEqual(8);
    expect(resized.x + resized.width).toBeLessThanOrEqual(892);
    expect(resized.y + resized.height).toBeLessThanOrEqual(642);
    await page.getByRole('button', { name: 'Open speech mode', exact: true }).click();
    const speechReview = page.getByRole('region', { name: 'VoiceGuard accessible privacy review' });
    await expect(speechReview).toBeVisible();
    await expect(
      speechReview.getByRole('button', { name: 'Start private voice', exact: true }),
    ).toBeVisible();
    await expect(speechReview).toContainText('Say “change”');
    await expect(speechReview.getByRole('status')).toContainText(
      /Listening|unavailable|permission|could not|recognition stopped/,
    );
    await page.screenshot({ path: 'test-results/draggable-shield-speech.png' });
  } finally {
    await context.close();
    await cleanProfile(profile);
  }
});

test('opt-in page translation restores conversation text and streaming replies but not the editable draft', async () => {
  const extension = path.resolve('dist'),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 },
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const root = `chrome-extension://${new URL(worker.url()).host}`,
      scope = 'https://chatgpt.com/c/translated-fixture';
    await context.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body style="background:#101010;color:#eee;font:18px/1.8 system-ui;padding:80px"><main><div data-message-author-role="user">Write to PERSON_1 at EMAIL_1.</div><div data-message-author-role="assistant"><p>Dear PERSON_1 at EMAIL_1. PERSON_10 and API_KEY_1 are unknown.</p></div><div contenteditable="true" role="textbox" style="margin-top:100px;background:#252525;padding:20px">Continue for PERSON_1 at EMAIL_1.</div></main></body></html>',
      }),
    );
    const chat = await context.newPage();
    await chat.goto(scope);
    const assistant = chat.locator('[data-message-author-role="assistant"]'),
      sent = chat.locator('[data-message-author-role="user"]');
    const bank = await context.newPage();
    await bank.goto(root + '/wordbank.html');
    // Seed a synthetic saved bank to test restoration independently of detection.
    await bank.evaluate(async (scope) => {
      await chrome.runtime.sendMessage({
        kind: 'bank-unlock',
        passphrase: 'a private test passphrase',
      });
      await chrome.runtime.sendMessage({
        kind: 'bank-add',
        scope,
        type: 'PERSON',
        original: 'Alice Tan',
      });
      await chrome.runtime.sendMessage({ kind: 'scan', scope, text: 'alice@example.com' });
    }, scope);
    await expect(assistant).toContainText('PERSON_1');
    await expect(chat.getByRole('button', { name: 'Show originals', exact: true })).toBeVisible();
    const popup = await context.newPage();
    await chat.bringToFront();
    await popup.goto(root + '/popup.html');
    await expect(
      popup.getByText('When enabled, this website can read restored names too.', { exact: false }),
    ).toBeVisible();
    await chat.getByRole('button', { name: 'Show originals', exact: true }).click();
    await expect(assistant).toContainText(
      'Dear Alice Tan at alice@example.com. PERSON_10 and API_KEY_1 are unknown.',
    );
    await expect(sent).toHaveText('Write to Alice Tan at alice@example.com.');
    await expect(chat.getByRole('textbox')).toHaveText('Continue for PERSON_1 at EMAIL_1.');
    await expect(chat.getByText('Original words ON', { exact: true })).toBeVisible();
    // Translation places Chinese directly beside tokens; writing cards can be
    // editable output inside the assistant message, unlike the prompt box.
    await assistant.evaluate((el) => {
      el.innerHTML =
        '<p><font>给PERSON_1和EMAIL_1。PERSON_10保留。</font></p><section contenteditable="true" role="textbox" data-testid="writing-card">Hi PERSON_1, contact EMAIL_1.</section>';
    });
    await expect(assistant.locator('p')).toHaveText(
      '给Alice Tan和alice@example.com。PERSON_10保留。',
    );
    await expect(assistant.locator('[data-testid="writing-card"]')).toHaveText(
      'Hi Alice Tan, contact alice@example.com.',
    );
    await expect(chat.locator('main > [role="textbox"]')).toHaveText(
      'Continue for PERSON_1 at EMAIL_1.',
    );
    // Whole-page switching must also reach cards outside message selectors,
    // preserving inline markup and ignoring unrelated controls and navigation.
    await chat.evaluate(() => {
      const card = document.createElement('section');
      card.id = 'portal-card';
      card.innerHTML =
        '<p>Hi <strong>PERSON_</strong><span>1</span>, contact <i>EMAIL</i><span>_1</span>.</p><p>PERSON_</p><p>1</p><button>PERSON_1</button>';
      document.body.append(card);
    });
    await expect(chat.locator('#portal-card p').first()).toHaveText(
      'Hi Alice Tan, contact alice@example.com.',
    );
    await expect(chat.locator('#portal-card strong')).toHaveText('Alice Tan');
    await expect(chat.locator('#portal-card p').nth(1)).toHaveText('PERSON_');
    await expect(chat.locator('#portal-card button')).toHaveText('PERSON_1');
    // Host stream updates: both replacing a text node and appending to one.
    await assistant.evaluate((el) => {
      el.textContent = 'New reply for PERSON_1.';
    });
    await expect(assistant).toHaveText('New reply for Alice Tan.');
    await assistant.evaluate((el) => (el.firstChild as Text).appendData(' Contact EMAIL_1.'));
    await expect(assistant).toHaveText('New reply for Alice Tan. Contact alice@example.com.');
    await chat.screenshot({ path: 'test-results/on-page-original-words.png' });
    await chat.getByRole('button', { name: 'Show placeholders', exact: true }).click();
    await expect(chat.locator('#portal-card strong')).toHaveText('PERSON_');
    await expect(chat.locator('#portal-card p').first()).toHaveText(
      'Hi PERSON_1, contact EMAIL_1.',
    );
    await expect(assistant).toHaveText('New reply for PERSON_1. Contact EMAIL_1.');
    await expect(sent).toHaveText('Write to PERSON_1 at EMAIL_1.');
    await expect(chat.getByRole('textbox')).toHaveText('Continue for PERSON_1 at EMAIL_1.');
    // Enable again and verify locking the bank removes the restored page view.
    await chat.bringToFront();
    await popup.reload();
    await popup
      .getByRole('button', { name: 'Show original words on this page', exact: true })
      .click();
    await expect(assistant).toContainText('Alice Tan');
    await bank.evaluate(() => chrome.runtime.sendMessage({ kind: 'bank-lock' }));
    await expect(assistant).toHaveText('New reply for PERSON_1. Contact EMAIL_1.');
    await expect(chat.getByRole('button', { name: 'Show originals', exact: true })).toBeVisible();
    await chat.getByRole('button', { name: 'Show originals', exact: true }).click();
    await expect(chat.getByRole('status')).toContainText('Unlock your word bank');
  } finally {
    await context.close();
    await cleanProfile(profile);
  }
});

test('extension reload shuts down stale content scripts without uncaught invalidation errors', async () => {
  const extension = path.resolve('dist'),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const root = `chrome-extension://${new URL(worker.url()).host}`,
      scope = 'https://chatgpt.com/c/reload-fixture';
    // Match the real Load unpacked workflow. Without Developer mode, Chromium
    // disables command-line-loaded extensions when runtime.reload() is called.
    // https://github.com/microsoft/playwright/issues/34711
    const management = await context.newPage();
    await management.goto('chrome://extensions/');
    await management.getByLabel('Developer mode', { exact: true }).click();
    await expect(
      management.getByRole('button', { name: 'Load unpacked', exact: true }),
    ).toBeVisible();
    await management.close();
    await context.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><main><div data-message-author-role="assistant">Hello PERSON_1.</div><div contenteditable="true" role="textbox">Email alice@example.com</div></main></body></html>',
      }),
    );
    const chat = await context.newPage();
    const errors: string[] = [];
    chat.on('pageerror', (error) => errors.push(error.message));
    await chat.goto(scope);
    const bank = await context.newPage();
    await bank.goto(root + '/wordbank.html');
    await bank.evaluate(async (scope) => {
      await chrome.runtime.sendMessage({
        kind: 'bank-unlock',
        passphrase: 'a private test passphrase',
      });
      await chrome.runtime.sendMessage({
        kind: 'bank-add',
        scope,
        type: 'PERSON',
        original: 'Alice Tan',
      });
      const [tab] = await chrome.tabs.query({ url: scope });
      await chrome.runtime.sendMessage({
        kind: 'page-view-set',
        tabId: tab.id,
        sourceScope: scope,
        enabled: true,
      });
    }, scope);
    await expect(chat.locator('[data-message-author-role="assistant"]')).toHaveText(
      'Hello Alice Tan.',
    );
    await chat.getByRole('textbox').focus();
    await expect(chat.getByRole('button', { name: 'Open Privruhty review' })).toBeVisible();
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
    // Force an input callback in the old isolated world after invalidation.
    await chat.getByRole('textbox').fill('Email bob@example.com');
    await expect(chat.locator('#pribruhty-reload')).toBeVisible({ timeout: 10000 });
    await expect(chat.locator('[data-message-author-role="assistant"]')).toHaveText(
      'Hello PERSON_1.',
    );
    await expect(chat.locator('#pribruhty-ui')).toHaveCount(0);
    await expect(chat.locator('#pribruhty-page-view')).toHaveCount(0);
    await chat.getByRole('textbox').fill('Email carol@example.com');
    await expect(chat.locator('#pribruhty-reload')).toHaveCount(1);
    expect(errors.filter((error) => /context invalidated/i.test(error))).toEqual([]);
    await expect
      .poll(
        () =>
          context.serviceWorkers().some((next) => next !== worker && next.url().startsWith(root)),
        { timeout: 10000 },
      )
      .toBe(true);
    await Promise.all([
      chat.waitForNavigation({ waitUntil: 'load' }),
      chat.getByRole('button', { name: 'Refresh tab', exact: true }).click(),
    ]);
    await expect(chat.locator('#pribruhty-reload')).toHaveCount(0);
    await expect
      .poll(() =>
        chat.evaluate(() =>
          [...document.querySelectorAll('style')].some((style) =>
            style.textContent?.includes('::highlight(pribruhty-sensitive)'),
          ),
        ),
      )
      .toBe(true);
    await chat.getByRole('textbox').fill('Email dave@example.com');
    await expect(chat.getByRole('button', { name: 'Open Privruhty review' })).toBeVisible();
    expect(errors.filter((error) => /context invalidated/i.test(error))).toEqual([]);
  } finally {
    await context.close();
    await cleanProfile(profile);
  }
});
