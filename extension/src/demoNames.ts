import type { Scan, Span } from './core';

// Deterministic fixtures for the presentation; these are not general NLP rules.
export const demoNames = [
  { original: 'Alice', replacement: 'PERSON_1' },
  { original: 'Bob', replacement: 'PERSON_2' },
] as const;
export function demoNameFindings(result: Scan, text: string): Scan {
  let spans = [...result.spans];
  for (const match of text.matchAll(
    /(?<![\p{L}\p{N}_@.])(Alice|Bob)(?![\p{L}\p{N}_@]|\.[\p{L}\p{N}])/giu,
  )) {
    const start = match.index!,
      end = start + match[0].length;
    const overlaps = spans.filter((span) => span.start < end && start < span.end);
    // Do not split a detected full name, email, credential, or manual-review value.
    if (
      overlaps.some(
        (span) =>
          span.strategy !== 'PSEUDONYM' ||
          !['PERSON', 'COMPANY', 'LOCATION', 'CUSTOM'].includes(span.type) ||
          span.start < start ||
          span.end > end,
      )
    )
      continue;
    spans = spans.filter((span) => !overlaps.includes(span));
    spans.push({
      start,
      end,
      type: 'PERSON',
      confidence: 1,
      replacement: demoNames.find((name) => name.original.toLowerCase() === match[0].toLowerCase())!
        .replacement,
      strategy: 'PSEUDONYM',
      reason: 'Fixed demo name: Alice is PERSON_1 and Bob is PERSON_2.',
    } satisfies Span);
  }
  return { ...result, spans: spans.sort((a, b) => a.start - b.start) };
}
