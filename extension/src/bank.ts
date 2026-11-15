import { apply, type Scan } from './core';
import { categories } from './voiceguard';
import { demoNames, demoNameFindings } from './demoNames';
export type Entry = {
  id: string;
  scope: string;
  original: string;
  replacement: string;
  type: string;
  createdAt: number;
};
export const TTL = 8 * 60 * 60 * 1000;
export const secretType = (type: string) =>
  /API_KEY|PASSWORD|TOKEN|CREDENTIAL|PRIVATE_KEY/.test(type);
export function includeKnownTerms(
  result: Scan,
  text: string,
  scope: string,
  entries: Entry[],
): Scan {
  let spans = [...result.spans];
  for (const e of entries
    .filter((e) => e.scope === scope && e.original && !secretType(e.type))
    .sort((a, b) => b.original.length - a.original.length)) {
    let at = 0;
    while ((at = text.toLowerCase().indexOf(e.original.toLowerCase(), at)) !== -1) {
      const start = at,
        end = at + e.original.length;
      at = end;
      if (/[\p{L}\p{N}_]/u.test(text[start - 1] || ' ') || /[\p{L}\p{N}_]/u.test(text[end] || ' '))
        continue;
      const overlaps = spans.filter((s) => s.start < end && start < s.end);
      if (overlaps.some((s) => s.strategy === 'BLOCK' || s.start < start || s.end > end)) continue;
      spans = spans.filter((s) => !overlaps.includes(s));
      spans.push({
        start,
        end,
        type: e.type,
        confidence: 1,
        replacement: e.replacement,
        strategy: 'PSEUDONYM',
        reason: 'Matches a term in this workspace word bank.',
      });
    }
  }
  return { ...result, spans: spans.sort((a, b) => a.start - b.start) };
}
export function assignMappings(result: Scan, text: string, scope: string, entries: Entry[]): Scan {
  result = demoNameFindings(result, text);
  const hasDemo = result.spans.some((span) => span.reason.startsWith('Fixed demo name:'));
  if (hasDemo) {
    for (const demo of demoNames) {
      const occupied = entries.find(
        (entry) => entry.scope === scope && entry.replacement === demo.replacement,
      );
      if (occupied && occupied.original.toLowerCase() !== demo.original.toLowerCase())
        throw new Error(
          `Demo slot ${demo.replacement} is already used in this workspace. Start a fresh chat or clear the demo word bank before using Alice and Bob.`,
        );
    }
    const missing = demoNames.filter(
      (demo) =>
        !entries.some((entry) => entry.scope === scope && entry.replacement === demo.replacement),
    );
    if (entries.length + missing.length > 2000)
      throw new Error('Word bank is full. Delete old entries before scanning.');
    for (const demo of missing)
      entries.push({
        id: crypto.randomUUID(),
        scope,
        type: 'PERSON',
        original: demo.original,
        replacement: demo.replacement,
        createdAt: Date.now(),
      });
  }
  const tokens = [
    ...text.matchAll(
      new RegExp(
        `(?<![A-Za-z0-9_])(?:${categories.join('|')}|DATE|IP_ADDRESS|AMOUNT)_\\d+(?![A-Za-z0-9_])`,
        'g',
      ),
    ),
  ].map((match) => ({ start: match.index!, end: match.index! + match[0].length }));
  const actionable = result.spans.filter(
    (span) =>
      span.strategy !== 'PSEUDONYM' ||
      (text.slice(span.start, span.end) !== span.replacement &&
        !tokens.some((token) => span.start >= token.start && span.end <= token.end)),
  );
  const spans = actionable.map((span) => {
    if (span.strategy !== 'PSEUDONYM' || secretType(span.type)) return span;
    const original = text.slice(span.start, span.end);
    if (
      !original ||
      original === span.replacement ||
      /\b(?:sk-|ghp_|password\s*[:=])/i.test(original)
    )
      return span;
    let entry = entries.find(
      (e) =>
        e.scope === scope &&
        e.type === span.type &&
        (!span.reason.startsWith('Fixed demo name:') || e.replacement === span.replacement) &&
        e.original.toLowerCase() === original.toLowerCase(),
    );
    if (!entry) {
      if (entries.length >= 2000)
        throw new Error('Word bank is full. Delete old entries before scanning.');
      let n = 1;
      while (
        entries.some((e) => e.scope === scope && e.replacement === `${span.type}_${n}`) ||
        new RegExp(`\\b${span.type}_${n}\\b`).test(text)
      )
        n++;
      entry = {
        id: crypto.randomUUID(),
        scope,
        type: span.type,
        original,
        replacement: `${span.type}_${n}`,
        createdAt: Date.now(),
      };
      entries.push(entry);
    }
    return { ...span, replacement: entry.replacement };
  });
  return { ...result, spans, protected: apply(text, spans) };
}
export type RestoredPart = { text: string; placeholder?: string };
export function restoreParts(text: string, scope: string, entries: Entry[]): RestoredPart[] {
  const known = new Map(
    entries
      .filter((e) => e.scope === scope && e.original && !secretType(e.type))
      .map((e) => [e.replacement, e.original]),
  );
  const result: RestoredPart[] = [];
  let end = 0;
  // One pass prevents restored originals from being interpreted as more placeholders.
  for (const match of text.matchAll(/(?<![A-Za-z0-9_])[A-Z][A-Z_]*_\d+(?![A-Za-z0-9_])/g)) {
    const original = known.get(match[0]);
    if (original === undefined) continue;
    result.push({ text: text.slice(end, match.index) }, { text: original, placeholder: match[0] });
    end = match.index! + match[0].length;
  }
  result.push({ text: text.slice(end) });
  return result;
}
