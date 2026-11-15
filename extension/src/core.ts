import { detectorConnection } from './detector';

export type Span = {
  start: number;
  end: number;
  type: string;
  confidence: number;
  replacement: string;
  strategy: string;
  reason: string;
};
export type Scan = {
  task: string;
  spans: Span[];
  protected: string;
  warnings: string[];
  safe_to_submit: boolean;
  scope?: string;
};
const patterns: [RegExp, string, number][] = [
  [
    /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{20,}|(?:api[_ -]?key|password|access[_ -]?token)\s*[:=]\s*[^\s,;]{6,})/gi,
    'API_KEY',
    0.99,
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL', 0.99],
  [/(?<!\w)(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\w)/g, 'PHONE', 0.9],
  [/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, 'CREDIT_CARD', 0.99],
];
export function luhn(value: string) {
  const d = [...value.replace(/\D/g, '')].map(Number).reverse();
  if (d.length < 13 || d.length > 19) return false;
  return (
    d.reduce((sum, n, i) => {
      let v = i % 2 ? n * 2 : n;
      return sum + (v > 9 ? v - 9 : v);
    }, 0) %
      10 ===
    0
  );
}
export function apply(text: string, spans: Span[]) {
  return [...spans]
    .sort((a, b) => b.start - a.start)
    .reduce((t, s) => t.slice(0, s.start) + s.replacement + t.slice(s.end), text);
}
export function fallback(text: string, custom: string[] = []): Scan {
  const found: Span[] = [];
  for (const [regex, type, confidence] of patterns) {
    for (const m of text.matchAll(regex)) {
      if (type === 'CREDIT_CARD' && !luhn(m[0])) continue;
      found.push({
        start: m.index,
        end: m.index + m[0].length,
        type,
        confidence,
        replacement: '',
        strategy: type === 'API_KEY' ? 'BLOCK' : 'PSEUDONYM',
        reason:
          type === 'API_KEY'
            ? 'Credentials should never be sent.'
            : 'Structured-data fallback detection.',
      });
    }
  }
  for (const term of custom.filter(Boolean)) {
    let at = 0;
    while ((at = text.toLowerCase().indexOf(term.toLowerCase(), at)) !== -1) {
      found.push({
        start: at,
        end: at + term.length,
        type: 'CUSTOM',
        confidence: 0.99,
        replacement: '',
        strategy: 'PSEUDONYM',
        reason: 'User-protected term.',
      });
      at += term.length;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const spans: Span[] = [],
    mapping = new Map<string, string>(),
    counts = new Map<string, number>();
  for (const s of found) {
    if (spans.some((x) => s.start < x.end && x.start < s.end)) continue;
    const key = s.type + ':' + text.slice(s.start, s.end).toLowerCase();
    if (s.type === 'API_KEY') s.replacement = '[SECRET REMOVED]';
    else {
      if (!mapping.has(key)) {
        const n = (counts.get(s.type) || 0) + 1;
        counts.set(s.type, n);
        mapping.set(key, `${s.type}_${n}`);
      }
      s.replacement = mapping.get(key)!;
    }
    spans.push(s);
  }
  return {
    task: 'GENERAL',
    spans,
    protected: apply(text, spans),
    warnings: [
      'Limited detection: automatic name detection needs the local service. Start the backend, then use Settings > Test connection. Structured data is still detected automatically.',
    ],
    safe_to_submit: true,
  };
}
export async function scan(text: string, scope = 'composer'): Promise<Scan> {
  const result = await chrome.runtime.sendMessage({ kind: 'scan', text, scope });
  if (result?.error) throw new Error(result.error);
  return result;
}
export async function detectLocally(text: string): Promise<Scan> {
  const { custom = '' } = await chrome.storage.local.get(['custom']);
  try {
    const { url, token } = await detectorConnection();
    if (!token) throw new Error('Detector token missing.');
    const r = await fetch(url + '/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pribruhty-token': token },
      body: JSON.stringify({
        text,
        custom: custom
          .split('\n')
          .map((x: string) => x.trim())
          .filter(Boolean),
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (r.ok) {
      const result: Scan = await r.json();
      const codepointToUtf16 = (index: number) => Array.from(text).slice(0, index).join('').length;
      result.spans = result.spans.map((s) => ({
        ...s,
        start: codepointToUtf16(s.start),
        end: codepointToUtf16(s.end),
      }));
      return result;
    }
  } catch {}
  return fallback(
    text,
    custom
      .split('\n')
      .map((x: string) => x.trim())
      .filter(Boolean),
  );
}
