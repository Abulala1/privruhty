import { describe, it, expect } from 'vitest';
import { fallback, luhn, apply } from './core';
describe('local fallback', () => {
  it('detects and maps repeated emails', () => {
    const x = fallback('😀 a@example.com a@example.com b@example.com');
    expect(x.protected).toContain('EMAIL_1 EMAIL_1 EMAIL_2');
    expect(x.spans[0].start).toBe(3);
  });
  it('validates cards and removes secrets', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true);
    expect(luhn('4111 1111 1111 1112')).toBe(false);
    expect(fallback('sk-abcdefghijklmnopqrstuvwxyz').protected).toBe('[SECRET REMOVED]');
  });
  it('applies spans from right to left', () => {
    expect(
      apply('abc def', [
        {
          start: 0,
          end: 3,
          replacement: 'X',
          type: 'CUSTOM',
          confidence: 1,
          strategy: 'PSEUDONYM',
          reason: '',
        },
        {
          start: 4,
          end: 7,
          replacement: 'Y',
          type: 'CUSTOM',
          confidence: 1,
          strategy: 'PSEUDONYM',
          reason: '',
        },
      ]),
    ).toBe('X Y');
  });
});
