import { afterEach, expect, it, vi } from 'vitest';
import { cloudOrigin, detectorConnection } from './detector';
import { detectLocally } from './core';
afterEach(() => vi.unstubAllGlobals());
function configure(cloudDetector: unknown, allowed = true) {
  const contains = vi.fn(async () => allowed);
  vi.stubGlobal('chrome', {
    storage: {
      local: { get: async () => ({ token: 'local-test-token', custom: '', cloudDetector }) },
    },
    permissions: { contains },
  });
  return contains;
}
it('accepts only HTTPS origins without credentials, paths or query strings', () => {
  expect(cloudOrigin('https://privacy.example.com/')).toBe('https://privacy.example.com');
  for (const url of [
    'http://privacy.example.com',
    'https://user:pass@example.com',
    'https://example.com/scan',
    'https://example.com?secret=x',
  ])
    expect(() => cloudOrigin(url)).toThrow();
});
it('keeps local default and requires consent plus a granted origin for cloud', async () => {
  const contains = configure(undefined);
  expect(await detectorConnection()).toMatchObject({ url: 'http://127.0.0.1:8765', cloud: false });
  expect(contains).not.toHaveBeenCalled();
  configure({
    enabled: true,
    url: 'https://privacy.example.com',
    token: 'cloud-token',
    consent: false,
  });
  await expect(detectorConnection()).rejects.toThrow(/consent/);
  configure(
    { enabled: true, url: 'https://privacy.example.com', token: 'cloud-token', consent: true },
    false,
  );
  await expect(detectorConnection()).rejects.toThrow(/Settings/);
});
it('sends scans only to the selected cloud origin and falls back on failure without sending to localhost', async () => {
  configure({
    enabled: true,
    url: 'https://privacy.example.com',
    token: 'cloud-test-token',
    consent: true,
  });
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          task: 'GENERAL',
          spans: [],
          protected: 'hello',
          warnings: [],
          safe_to_submit: true,
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  await detectLocally('hello');
  expect(fetchMock).toHaveBeenCalledWith(
    'https://privacy.example.com/scan',
    expect.objectContaining({
      redirect: 'error',
      headers: expect.objectContaining({ 'x-pribruhty-token': 'cloud-test-token' }),
    }),
  );
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  expect((await detectLocally('alice@example.com')).protected).toBe('EMAIL_1');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
