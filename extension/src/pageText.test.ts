import { expect, it } from 'vitest';
import { distributeParts } from './pageText';
import { restoreParts, type Entry } from './bank';
it('switches tokens spanning formatting nodes without flattening surrounding text', () => {
  const entries: Entry[] = [
    {
      id: '1',
      scope: 'a',
      type: 'EMAIL',
      replacement: 'EMAIL_1',
      original: 'alice@example.com',
      createdAt: 0,
    },
  ];
  const source = ['Send E', 'MAIL', '_1', ' today. EMAIL_', '1!'];
  const parts = restoreParts(source.join(''), 'a', entries);
  expect(distributeParts(source, parts)).toEqual([
    'Send alice@example.com',
    '',
    '',
    ' today. alice@example.com',
    '!',
  ]);
  expect(source).toEqual(['Send E', 'MAIL', '_1', ' today. EMAIL_', '1!']);
});
