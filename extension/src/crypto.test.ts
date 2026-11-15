import { describe, it, expect } from 'vitest';
import { seal, unseal } from './crypto';
describe('authenticated local encryption', () => {
  it('round trips a word bank, randomizes ciphertext, and rejects wrong passphrases and tampering', async () => {
    const data = { original: 'Alice Tan', replacement: 'PERSON_1' };
    const a = await seal(data, 'a private test passphrase', 'word-bank'),
      b = await seal(data, 'a private test passphrase', 'word-bank');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(JSON.stringify(a)).not.toContain('Alice');
    expect(await unseal(a, 'a private test passphrase', 'word-bank')).toEqual(data);
    await expect(unseal(a, 'incorrect passphrase here', 'word-bank')).rejects.toThrow();
    await expect(
      unseal(
        { ...a, ciphertext: 'AAAA' + a.ciphertext.slice(4) },
        'a private test passphrase',
        'word-bank',
      ),
    ).rejects.toThrow();
    await expect(
      unseal({ ...a, kind: 'file' }, 'a private test passphrase', 'file'),
    ).rejects.toThrow();
  });
  it('rejects short passphrases and malformed envelopes', async () => {
    await expect(seal({}, 'short', 'file')).rejects.toThrow();
    await expect(unseal({ version: 99 }, 'a private test passphrase', 'file')).rejects.toThrow();
  });
});
