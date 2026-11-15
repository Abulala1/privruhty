import { it, expect, vi } from 'vitest';
import { protectAttachment } from './attachmentFiles';
import { attachmentPreferences } from './attachmentPolicy';
import { fallback } from './core';
import { parseDocument } from './files';

it('makes a protected copy with generic metadata, preserving the original and removing credentials', async () => {
  const original = new File(
    ['Email alice@example.com. Key sk-abcdefghijklmnopqrstuvwxyz'],
    'Alice-private-records.txt',
    { type: 'text/plain', lastModified: 12345 },
  );
  const result = await protectAttachment(
    original,
    0,
    async (text) => fallback(text),
    new AbortController().signal,
  );
  expect(await result.file.text()).toBe('Email EMAIL_1. Key [SECRET REMOVED]');
  expect(result.file.name).toBe('protected-document-1.txt');
  expect(result.file.lastModified).toBe(0);
  expect(result.findings).toBe(2);
  expect(result.limited).toBe(true);
  expect(await original.text()).toContain('alice@example.com');
  expect(original.name).toBe('Alice-private-records.txt');
});

it('reuses verified CSV export while preserving quotes and cell structure', async () => {
  const original = new File(
    ['name,email,note\n"Example, Alex",alex@example.com,"first\nsecond"\n'],
    'confidential.csv',
  );
  const result = await protectAttachment(
    original,
    1,
    async (text) => fallback(text),
    new AbortController().signal,
  );
  const parsed = parseDocument(await result.file.text(), true);
  expect(parsed.rows?.[1]).toEqual(['Example, Alex', 'EMAIL_1', 'first\nsecond']);
  expect(result.file.type).toBe('text/csv');
  expect(result.file.name).toBe('protected-document-2.csv');
});

it('rejects unsupported, oversized, binary, and invalid UTF-8 input before scanning', async () => {
  const scan = vi.fn(async (text) => fallback(text));
  for (const file of [
    new File(['data'], 'private.pdf'),
    new File([new Uint8Array(1_000_001)], 'huge.txt'),
    new File(['%PDF-1.7'], 'disguised.txt'),
    new File(['hello\0world'], 'binary.txt'),
    new File([new Uint8Array([0xff, 0xfe, 0xfd])], 'invalid.txt'),
  ]) {
    await expect(protectAttachment(file, 0, scan, new AbortController().signal)).rejects.toThrow(
      /Upload held/,
    );
  }
  expect(scan).not.toHaveBeenCalled();
});

it('holds manual-review and malformed-range results and honors cancellation after a scan', async () => {
  const file = new File(['alice@example.com'], 'data.txt');
  await expect(
    protectAttachment(
      file,
      0,
      async (text) => ({ ...fallback(text), safe_to_submit: false }),
      new AbortController().signal,
    ),
  ).rejects.toThrow(/manual-review/);
  await expect(
    protectAttachment(
      file,
      0,
      async (text) => {
        const result = fallback(text);
        result.spans[0].end = 999;
        return result;
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow(/invalid replacement ranges/);
  const controller = new AbortController();
  await expect(
    protectAttachment(
      file,
      0,
      async (text) => {
        controller.abort();
        return fallback(text);
      },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(attachmentPreferences(null)).toEqual({ enabled: true, mode: 'auto' });
  expect(attachmentPreferences({ enabled: false, mode: 'unknown' })).toEqual({
    enabled: false,
    mode: 'auto',
  });
});

it('does not apply findings across CSV cells', async () => {
  const file = new File(['left,right\na,b'], 'data.csv');
  await expect(
    protectAttachment(
      file,
      0,
      async (text) => ({
        ...fallback(text),
        spans: [
          {
            start: 0,
            end: text.length,
            type: 'CUSTOM',
            confidence: 1,
            strategy: 'PSEUDONYM',
            replacement: 'CUSTOM_1',
            reason: 'Synthetic crossing span',
          },
        ],
      }),
      new AbortController().signal,
    ),
  ).rejects.toThrow(/cell boundaries/);
});
