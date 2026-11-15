export const localDetectorUrl = 'http://127.0.0.1:8765';

export function cloudOrigin(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(
      'Use an HTTPS origin such as https://privacy.your-domain.com without a path or credentials.',
    );
  return url.origin;
}

export async function detectorConnection(): Promise<{
  url: string;
  token: string;
  cloud: boolean;
}> {
  const { token = '', cloudDetector } = await chrome.storage.local.get(['token', 'cloudDetector']);
  if (cloudDetector?.enabled === true) {
    if (cloudDetector.consent !== true) throw new Error('Cloud scanning requires consent.');
    const url = cloudOrigin(cloudDetector.url);
    if (!(await chrome.permissions.contains({ origins: [url + '/*'] })))
      throw new Error('Allow access to your cloud detector in Settings.');
    return { url, token: String(cloudDetector.token || ''), cloud: true };
  }
  return { url: localDetectorUrl, token, cloud: false };
}
