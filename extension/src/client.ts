export async function request<T = any>(
  kind: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const result = await chrome.runtime.sendMessage({ kind, ...data });
  if (result?.error) throw new Error(result.error);
  return result;
}
export const supportedUrls = [
  'https://chatgpt.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
];
export function scopeFromUrl(url: string) {
  const u = new URL(url);
  return u.origin + u.pathname;
}
export function scopeLabel(scope: string) {
  if (scope.startsWith('document:')) return 'Document ' + scope.slice(9, 17);
  if (scope === 'composer') return 'Private composer';
  try {
    const u = new URL(scope);
    return (
      u.hostname +
      (u.pathname === '/'
        ? ' · new chat'
        : ' · ' + u.pathname.split('/').filter(Boolean).pop()?.slice(0, 12))
    );
  } catch {
    return scope;
  }
}
