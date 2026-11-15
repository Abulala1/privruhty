import { describe, it, expect } from 'vitest';
import { assignMappings, includeKnownTerms, restoreParts, type Entry } from './bank';
import { fallback } from './core';
describe('word bank and private restoration', () => {
  it('allocates person mappings from detections without reserved demo identities', () => {
    const entries: Entry[] = [];
    const detected = (text: string) => ({
      ...fallback(text),
      spans: [
        {
          start: 0,
          end: text.length,
          type: 'PERSON',
          confidence: 0.9,
          replacement: 'PERSON_1',
          strategy: 'PSEUDONYM',
          reason: 'Detector result',
        },
      ],
    });
    expect(assignMappings(detected('Bob'), 'Bob', 'clean', entries).protected).toBe('PERSON_1');
    expect(entries.map((entry) => entry.original)).toEqual(['Bob']);
    expect(assignMappings(detected('Alice'), 'Alice', 'clean', entries).protected).toBe('PERSON_2');
    expect(entries.map((entry) => entry.original)).toEqual(['Bob', 'Alice']);
  });
  it('does not suggest replacing protected tokens again or retain no-op findings', () => {
    const text = 'Hi LOCATION_1 at alice@example.com';
    const result = fallback(text);
    result.spans.unshift({
      start: 3,
      end: 11,
      type: 'LOCATION',
      confidence: 0.85,
      replacement: 'LOCATION_2',
      strategy: 'PSEUDONYM',
      reason: 'False NLP detection',
    });
    result.spans.unshift({
      start: 3,
      end: 13,
      type: 'LOCATION',
      confidence: 1,
      replacement: 'LOCATION_1',
      strategy: 'PSEUDONYM',
      reason: 'Already protected',
    });
    const entries: Entry[] = [];
    const scan = assignMappings(result, text, 'a', entries);
    expect(scan.spans).toHaveLength(1);
    expect(scan.spans[0].type).toBe('EMAIL');
    expect(scan.protected).toBe('Hi LOCATION_1 at EMAIL_1');
    expect(entries.map((entry) => entry.original)).toEqual(['alice@example.com']);
  });
  it('restores placeholders beside Chinese text and translation markup text', () => {
    const entries: Entry[] = [
      {
        id: '1',
        scope: 'a',
        original: 'Alice',
        replacement: 'COMPANY_1',
        type: 'COMPANY',
        createdAt: 0,
      },
      {
        id: '2',
        scope: 'a',
        original: 'alice@example.com',
        replacement: 'EMAIL_1',
        type: 'EMAIL',
        createdAt: 0,
      },
    ];
    expect(
      restoreParts('给COMPANY_1和EMAIL_1。COMPANY_10保留', 'a', entries)
        .map((p) => p.text)
        .join(''),
    ).toBe('给Alice和alice@example.com。COMPANY_10保留');
  });
  it('keeps identifiers stable across scans and separates workspaces', () => {
    const entries: Entry[] = [];
    const first = assignMappings(
      fallback('a@example.com b@example.com'),
      'a@example.com b@example.com',
      'chat-a',
      entries,
    );
    expect(first.protected).toBe('EMAIL_1 EMAIL_2');
    expect(
      assignMappings(fallback('b@example.com'), 'b@example.com', 'chat-a', entries).protected,
    ).toBe('EMAIL_2');
    expect(
      assignMappings(fallback('c@example.com'), 'c@example.com', 'chat-b', entries).protected,
    ).toBe('EMAIL_1');
    expect(
      restoreParts('EMAIL_1', 'chat-a', entries)
        .map((p) => p.text)
        .join(''),
    ).toBe('a@example.com');
    expect(
      restoreParts('EMAIL_1', 'chat-b', entries)
        .map((p) => p.text)
        .join(''),
    ).toBe('c@example.com');
  });
  it('never stores credentials and restores only exact known tokens', () => {
    const entries: Entry[] = [];
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz';
    assignMappings(fallback(secret), secret, 'a', entries);
    expect(entries).toHaveLength(0);
    assignMappings(fallback('alice@example.com'), 'alice@example.com', 'a', entries);
    const restored = restoreParts(
      'EMAIL_1 EMAIL_10 xEMAIL_1 EMAIL_1x EMAIL_1_ API_KEY_1',
      'a',
      entries,
    )
      .map((p) => p.text)
      .join('');
    expect(restored).toBe('alice@example.com EMAIL_10 xEMAIL_1 EMAIL_1x EMAIL_1_ API_KEY_1');
  });
  it('uses manually protected names without depending on NER', () => {
    const entries: Entry[] = [
      {
        id: '1',
        scope: 'a',
        original: 'Alice Tan',
        replacement: 'PERSON_1',
        type: 'PERSON',
        createdAt: 0,
      },
    ];
    const text = 'Email Alice Tan. NotAlice Tan remains.';
    const result = assignMappings(
      includeKnownTerms(fallback(text), text, 'a', entries),
      text,
      'a',
      entries,
    );
    expect(result.protected).toBe('Email PERSON_1. NotAlice Tan remains.');
  });
  it('does not recursively restore or reuse deleted tokens', () => {
    const entries: Entry[] = [
      {
        id: '1',
        scope: 'a',
        original: 'PERSON_2',
        replacement: 'PERSON_1',
        type: 'PERSON',
        createdAt: 0,
      },
      {
        id: '2',
        scope: 'a',
        original: 'Alice',
        replacement: 'PERSON_2',
        type: 'PERSON',
        createdAt: 0,
      },
    ];
    expect(
      restoreParts('PERSON_1', 'a', entries)
        .map((p) => p.text)
        .join(''),
    ).toBe('PERSON_2');
    entries[0].original = '';
    const text = 'bob@example.com';
    expect(assignMappings(fallback(text), text, 'a', entries).protected).toBe('EMAIL_1');
    entries.push({
      id: '3',
      scope: 'a',
      original: '',
      replacement: 'EMAIL_1',
      type: 'EMAIL',
      createdAt: 0,
    });
    // The existing Bob mapping is reused; a new value gets a fresh token.
    expect(assignMappings(fallback('c@example.com'), 'c@example.com', 'a', entries).protected).toBe(
      'EMAIL_2',
    );
  });
});
