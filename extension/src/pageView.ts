import { restoreParts, type Entry } from './bank';

export const supportedPage = (url: string) =>
  /^https:\/\/(chatgpt\.com|claude\.ai|gemini\.google\.com)\//.test(url);
export function pageScope(url: string) {
  const value = new URL(url);
  return value.origin + value.pathname;
}
export type PageGrant = { pageScope: string; sourceScope: string };

export function restorePageBatch(texts: unknown, scope: string, entries: Entry[]) {
  if (
    !Array.isArray(texts) ||
    texts.length > 200 ||
    texts.some((t) => typeof t !== 'string') ||
    texts.reduce((n, t) => n + t.length, 0) > 200_000
  )
    throw new Error('Page text is too large.');
  return (texts as string[]).map((text) =>
    restoreParts(text, scope, entries)
      .map((part) => part.text)
      .join(''),
  );
}
