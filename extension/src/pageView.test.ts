import { it, expect } from 'vitest';
import { restorePageBatch, supportedPage, pageScope } from './pageView';
it('restores only exact known non-secret tokens for the chosen conversation', () => {
  const entries = [
    {
      id: '1',
      scope: 'chat-a',
      original: 'Alice',
      replacement: 'PERSON_1',
      type: 'PERSON',
      createdAt: 0,
    },
    {
      id: '2',
      scope: 'chat-b',
      original: 'Bob',
      replacement: 'PERSON_1',
      type: 'PERSON',
      createdAt: 0,
    },
    {
      id: '3',
      scope: 'chat-a',
      original: 'secret-value',
      replacement: 'API_KEY_1',
      type: 'API_KEY',
      createdAt: 0,
    },
  ];
  expect(
    restorePageBatch(['Hello PERSON_1. PERSON_10 and API_KEY_1 stay.'], 'chat-a', entries),
  ).toEqual(['Hello Alice. PERSON_10 and API_KEY_1 stay.']);
  expect(() => restorePageBatch([5], 'chat-a', entries)).toThrow();
  expect(() => restorePageBatch(['a'.repeat(200001)], 'chat-a', entries)).toThrow();
  expect(supportedPage('https://chatgpt.com.evil.example/c/test')).toBe(false);
  expect(supportedPage('https://chatgpt.com/c/test')).toBe(true);
  expect(pageScope('https://chatgpt.com/c/test?source=foo#bar')).toBe('https://chatgpt.com/c/test');
});
