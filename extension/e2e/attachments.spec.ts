import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

async function fixture(
  options: { input?: boolean; acceptDrop?: boolean; transient?: boolean } = {},
) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pribruhty-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${path.resolve('dist')}`,
      `--load-extension=${path.resolve('dist')}`,
    ],
    viewport: { width: 1280, height: 900 },
  });
  const uploads: string[] = [];
  const html = `<!doctype html><html><head><script>
    window.seen=[]; window.sent=0;
    async function upload(files) {
      const data=new FormData(); for(const file of files){window.seen.push({name:file.name,text:await file.text()});data.append('files',file);}
      await fetch('/upload',{method:'POST',body:data});
    }
    window.addEventListener('change',event=>{if(event.target.type==='file')void upload([...event.target.files]);},true);
    window.addEventListener('input',event=>{if(event.target.type==='file')for(const f of event.target.files)window.seen.push({event:'input',name:f.name});},true);
    window.addEventListener('drop',event=>{if(${options.acceptDrop !== false}&&event.dataTransfer?.files.length){event.preventDefault();void upload([...event.dataTransfer.files]);}},true);
    window.addEventListener('paste',event=>{if(${options.acceptDrop !== false}&&event.clipboardData?.files.length){event.preventDefault();void upload([...event.clipboardData.files]);}},true);
    window.addEventListener('dragleave',()=>{if(${!!options.transient})document.getElementById('drop-zone')?.remove();});
  </script></head><body style="font:16px system-ui;background:#101010;color:#eee;padding:100px">
    <main><form onsubmit="event.preventDefault();window.sent++">${options.input !== false ? '<input id="attachment-input" type="file" accept=".txt,.csv,.pdf" multiple>' : ''}
    <div id="prompt-textarea" role="textbox" contenteditable="true" style="padding:20px;border:1px solid #777;margin:40px 0"></div><button type="submit">Send message</button></form>
    <div id="drop-zone" style="padding:40px;border:2px dashed #aaa">Drop here</div></main>
  </body></html>`;
  for (const host of ['chatgpt.com', 'claude.ai', 'gemini.google.com']) {
    await context.route(`https://${host}/**`, async (route) => {
      if (route.request().url().endsWith('/upload')) {
        uploads.push(route.request().postDataBuffer()?.toString('utf8') || '');
        await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      } else await route.fulfill({ contentType: 'text/html', body: html });
    });
  }
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const root = `chrome-extension://${new URL(worker.url()).host}`;
  const control = await context.newPage();
  await control.goto(root + '/settings.html');
  const chat = await context.newPage();
  await chat.goto('https://chatgpt.com/c/attachment-fixture');
  return {
    context,
    chat,
    control,
    uploads,
    root,
    async close() {
      await context.close();
      const resolved = path.resolve(profile);
      if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('pribruhty-e2e-')
      )
        throw new Error('Unsafe test-profile cleanup');
      await fs.rm(resolved, { recursive: true, force: true });
    },
  };
}

async function transfer(
  page: Page,
  files: { name: string; text: string; type?: string }[],
  trigger: 'drop' | 'paste' = 'drop',
) {
  await page.evaluate(
    ({ files, trigger }) => {
      const dt = new DataTransfer();
      for (const file of files)
        dt.items.add(new File([file.text], file.name, { type: file.type || 'text/plain' }));
      const event =
        trigger === 'drop'
          ? new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer: dt,
            })
          : new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              composed: true,
              clipboardData: dt,
            });
      (
        document.getElementById('drop-zone') || document.getElementById('prompt-textarea')!
      ).dispatchEvent(event);
    },
    { files, trigger },
  );
}
const panel = (page: Page) => page.getByRole('region', { name: 'Privruhty attachment protection' });

test('cloud settings require explicit consent and show the final server controls', async () => {
  const f = await fixture();
  try {
    const cloud = f.control.getByRole('region', { name: 'Vultr cloud detector' });
    await cloud.getByLabel('Use cloud detector').check();
    await cloud.getByLabel('Cloud HTTPS URL').fill('https://privacy.example.com');
    await cloud
      .getByLabel('Cloud service token')
      .fill('synthetic-test-token-not-a-real-service-key');
    await cloud.getByRole('button', { name: 'Save cloud settings' }).click();
    await expect(cloud.getByRole('status')).toContainText('Confirm cloud scanning');
    expect(
      await f.control.evaluate(
        async () => (await chrome.storage.local.get('cloudDetector')).cloudDetector,
      ),
    ).toBeUndefined();
    await cloud.screenshot({ path: 'test-results/vultr-cloud-settings.png' });
    await cloud.getByLabel('Use cloud detector').uncheck();
    await cloud.getByRole('button', { name: 'Save cloud settings' }).click();
    await expect(cloud.getByRole('status')).toContainText('Local detection selected');
  } finally {
    await f.close();
  }
});

test('auto-protects drops on all supported hosts, file picks, pasted files, and actual multipart upload bytes', async () => {
  const f = await fixture();
  try {
    for (const [i, host] of ['chatgpt.com', 'claude.ai', 'gemini.google.com'].entries()) {
      await f.chat.goto(`https://${host}/c/attachment-fixture`);
      await transfer(f.chat, [
        {
          name: 'Alice-confidential.txt',
          text: 'Email alice@example.com and remove sk-abcdefghijklmnopqrstuvwxyz',
        },
      ]);
      await expect.poll(() => f.uploads.length).toBe(i + 1);
      expect(f.uploads[i]).toContain('EMAIL_1');
      expect(f.uploads[i]).toContain('[SECRET REMOVED]');
      expect(f.uploads[i]).toContain('protected-document-1.txt');
      expect(f.uploads[i]).not.toContain('alice@example.com');
      expect(f.uploads[i]).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
      expect(f.uploads[i]).not.toContain('Alice-confidential');
      await expect(panel(f.chat)).toContainText('Limited detection');
      expect(await f.chat.evaluate(() => (window as any).sent)).toBe(0);
    }
    await f.chat.goto('https://chatgpt.com/c/attachment-fixture');
    await f.chat.locator('#attachment-input').setInputFiles({
      name: 'private.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,email\n"Example, Alex",alice@example.com\n'),
    });
    await expect.poll(() => f.uploads.length).toBe(4);
    expect(f.uploads[3]).toContain('"Example, Alex",EMAIL_1');
    expect(f.uploads[3]).not.toContain('alice@example.com');
    await transfer(f.chat, [{ name: 'contact.txt', text: 'Call 415-555-0199' }], 'paste');
    await expect.poll(() => f.uploads.length).toBe(5);
    expect(f.uploads[4]).toContain('PHONE_1');
    expect(f.uploads[4]).not.toContain('415-555-0199');
    const seen = JSON.stringify(await f.chat.evaluate(() => (window as any).seen));
    expect(seen).not.toContain('alice@example.com');
    expect(seen).not.toContain('415-555-0199');
    const bank = await f.control.evaluate(() =>
      chrome.runtime.sendMessage({ kind: 'bank-status' }),
    );
    expect(
      bank.entries.some(
        (entry: any) =>
          entry.scope === 'https://chatgpt.com/c/attachment-fixture' &&
          entry.original === 'alice@example.com',
      ),
    ).toBe(true);
    await f.chat.screenshot({ path: 'test-results/attachment-auto-protection.png' });
  } finally {
    await f.close();
  }
});

test('holds review batches, allows cancellation, rejects unsupported batches, and preserves ordinary text paste', async () => {
  const f = await fixture();
  try {
    await f.control.getByLabel('Attachment handling').selectOption('review');
    await transfer(f.chat, [
      { name: 'secret.txt', text: 'alice@example.com' },
      { name: 'more.csv', text: 'email\nbob@example.com' },
    ]);
    await expect(
      panel(f.chat).getByRole('button', { name: 'Attach protected copies' }),
    ).toBeVisible();
    expect(f.uploads).toHaveLength(0);
    await panel(f.chat).getByRole('button', { name: 'Cancel upload' }).click();
    await expect(panel(f.chat)).toContainText('Upload canceled');
    expect(f.uploads).toHaveLength(0);
    await transfer(f.chat, [{ name: 'secret.txt', text: 'alice@example.com' }]);
    await panel(f.chat).getByRole('button', { name: 'Attach protected copies' }).click();
    await expect.poll(() => f.uploads.length).toBe(1);
    await transfer(f.chat, [
      { name: 'good.txt', text: 'bob@example.com' },
      { name: 'private.pdf', text: '%PDF original@example.com' },
    ]);
    await expect(panel(f.chat)).toContainText('TXT and CSV only');
    expect(f.uploads).toHaveLength(1);
    await f.chat.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'ordinary paste');
      document
        .getElementById('prompt-textarea')!
        .dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
        );
    });
    expect(f.uploads).toHaveLength(1);
    await f.control.getByLabel('Enable attachment protection', { exact: true }).uncheck();
    await f.chat.locator('#attachment-input').setInputFiles({
      name: 'explicitly-unprotected.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('intentionally-public@example.com'),
    });
    await expect.poll(() => f.uploads.length).toBe(2);
    expect(f.uploads[1]).toContain('intentionally-public@example.com');
    await expect(panel(f.chat)).toContainText('protection is disabled');
  } finally {
    await f.close();
  }
});

test('replays protected drops after a transient overlay disappears and offers download when the site ignores replay', async () => {
  const f = await fixture({ input: false, transient: true });
  try {
    await transfer(f.chat, [{ name: 'private.txt', text: 'alice@example.com' }]);
    await expect.poll(() => f.uploads.length).toBe(1);
    expect(f.uploads[0]).toContain('EMAIL_1');
    expect(f.uploads[0]).not.toContain('alice@example.com');
  } finally {
    await f.close();
  }
  const fallback = await fixture({ input: false, acceptDrop: false });
  try {
    await transfer(fallback.chat, [{ name: 'private.txt', text: 'alice@example.com' }]);
    await expect(
      panel(fallback.chat).getByRole('button', { name: 'Download protected copies' }),
    ).toBeVisible();
    expect(fallback.uploads).toHaveLength(0);
    const wait = fallback.chat.waitForEvent('download');
    await panel(fallback.chat).getByRole('button', { name: 'Download protected copies' }).click();
    const download = await wait;
    expect(download.suggestedFilename()).toBe('protected-document-1.txt');
    const filename = await download.path();
    expect(await fs.readFile(filename!, 'utf8')).toBe('EMAIL_1');
  } finally {
    await fallback.close();
  }
});

test('locks, scope changes, malformed CSV, and large files never release original attachments', async () => {
  const f = await fixture();
  try {
    await f.control.evaluate(async () => {
      await chrome.runtime.sendMessage({
        kind: 'bank-unlock',
        passphrase: 'synthetic attachment passphrase',
      });
      await chrome.storage.local.set({ attachmentProtection: { enabled: true, mode: 'review' } });
    });
    await transfer(f.chat, [{ name: 'private.txt', text: 'alice@example.com' }]);
    await expect(
      panel(f.chat).getByRole('button', { name: 'Attach protected copies' }),
    ).toBeVisible();
    await f.control.evaluate(() => chrome.runtime.sendMessage({ kind: 'bank-lock' }));
    await panel(f.chat).getByRole('button', { name: 'Attach protected copies' }).click();
    await expect(panel(f.chat)).toContainText('word bank changed');
    expect(f.uploads).toHaveLength(0);
    await transfer(f.chat, [{ name: 'private.txt', text: 'alice@example.com' }]);
    await expect(panel(f.chat)).toContainText('Unlock your word bank');
    await f.control.evaluate(() =>
      chrome.runtime.sendMessage({
        kind: 'bank-unlock',
        passphrase: 'synthetic attachment passphrase',
      }),
    );
    await transfer(f.chat, [{ name: 'private.txt', text: 'alice@example.com' }]);
    await expect(
      panel(f.chat).getByRole('button', { name: 'Attach protected copies' }),
    ).toBeVisible();
    await f.chat.evaluate(() => history.pushState({}, '', '/c/a-different-chat'));
    await expect(panel(f.chat)).toContainText('chat changed');
    expect(f.uploads).toHaveLength(0);
    await transfer(f.chat, [{ name: 'bad.csv', text: 'a,b\n"unterminated' }]);
    await expect(panel(f.chat)).toContainText('CSV could not be parsed');
    await f.chat.locator('#attachment-input').setInputFiles({
      name: 'large.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(1_000_001, 65),
    });
    await expect(panel(f.chat)).toContainText('1 MB');
    expect(f.uploads).toHaveLength(0);
    expect(JSON.stringify(await f.chat.evaluate(() => (window as any).seen))).not.toContain(
      'alice@example.com',
    );
  } finally {
    await f.close();
  }
});
