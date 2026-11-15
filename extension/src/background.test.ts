import { it, expect, vi } from 'vitest';

it('encrypts bank persistence, authorizes restoration, and fails closed while locked', async () => {
  const stored: Record<string, unknown> = {};
  let listener: (message: any, sender: any, reply: (value: any) => void) => void;
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (path: string) => 'chrome-extension://test/' + path,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const result: Record<string, unknown> = {};
          for (const key of typeof keys === 'string' ? [keys] : keys) result[key] = stored[key];
          return result;
        },
        set: async (values: Record<string, unknown>) =>
          Object.assign(stored, structuredClone(values)),
        remove: async (key: string) => {
          delete stored[key];
        },
      },
    },
    tabs: {
      get: async (id: number) => ({ id, url: 'https://chatgpt.com/c/test' }),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
  });
  await import('./background');
  const ui = { url: 'chrome-extension://test/wordbank.html' };
  const page = { url: 'https://chatgpt.com/c/test', tab: { id: 17 }, frameId: 0 };
  const send = (message: any, sender: any = ui) =>
    new Promise<any>((resolve) => listener(message, sender, resolve));
  expect(await send({ kind: 'bank-unlock', passphrase: 'a private test passphrase' })).toEqual({
    ok: true,
  });
  expect(
    await send({
      kind: 'bank-add',
      scope: 'https://chatgpt.com/c/test',
      type: 'PERSON',
      original: 'Alice Tan',
    }),
  ).toEqual({ ok: true });
  const result = await send({ kind: 'scan', text: 'Write to Alice Tan' }, page);
  expect(result.protected).toBe('Write to PERSON_1');
  expect(JSON.stringify(stored)).not.toContain('Alice');
  expect(JSON.stringify(stored)).not.toContain('passphrase');
  expect((await send({ kind: 'bank-status' }, page)).error).toMatch(/only inside/);
  expect(
    (await send({ kind: 'restore', text: 'PERSON_1', scope: 'https://chatgpt.com/c/test' }, page))
      .error,
  ).toMatch(/only inside/);
  expect(
    (await send({ kind: 'restore', text: 'PERSON_1', scope: 'https://chatgpt.com/c/test' }))
      .map((p: any) => p.text)
      .join(''),
  ).toBe('Alice Tan');
  expect((await send({ kind: 'page-restore', texts: ['PERSON_1'] }, page)).error).toMatch(
    /Enable on-page/,
  );
  expect(
    (
      await send(
        {
          kind: 'page-view-set',
          tabId: 17,
          enabled: true,
          sourceScope: 'https://chatgpt.com/c/test',
        },
        page,
      )
    ).error,
  ).toMatch(/only inside/);
  expect(
    await send({
      kind: 'page-view-set',
      tabId: 17,
      enabled: true,
      sourceScope: 'https://chatgpt.com/c/test',
    }),
  ).toEqual({ ok: true });
  expect(
    (await send({ kind: 'page-restore', texts: ['PERSON_1 API_KEY_1 PERSON_10'] }, page)).texts,
  ).toEqual(['Alice Tan API_KEY_1 PERSON_10']);
  expect(
    (await send({ kind: 'page-restore', texts: ['PERSON_1'] }, { ...page, tab: { id: 18 } })).error,
  ).toMatch(/Enable on-page/);
  expect(
    (
      await send(
        { kind: 'page-restore', texts: ['PERSON_1'] },
        { ...page, url: 'https://chatgpt.com/c/other' },
      )
    ).error,
  ).toMatch(/Enable on-page/);
  expect(
    (
      await send({
        kind: 'page-view-set',
        tabId: 17,
        enabled: true,
        sourceScope: 'https://evil.example/',
      })
    ).error,
  ).toMatch(/Choose the word bank/);
  const metadata = {
    detected_type: 'EMAIL',
    task_type: 'WRITING',
    suggested_strategy: 'PSEUDONYM',
    explanation_level: 'SIMPLE',
    question_type: 'EXPLAIN_RISK',
  };
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ source: 'unavailable' }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  expect(
    (
      await send({
        kind: 'explain-risk',
        metadata: { ...metadata, original: 'alice@example.com' },
        consent: true,
      })
    ).error,
  ).toMatch(/metadata/);
  expect((await send({ kind: 'explain-risk', metadata, consent: false })).error).toMatch(
    /metadata/,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  stored.token = 'synthetic-local-token';
  expect(await send({ kind: 'explain-risk', metadata, consent: true })).toEqual({
    source: 'unavailable',
  });
  const body = JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
  );
  expect(body).toEqual({ ...metadata, consent: true });
  expect(JSON.stringify(body)).not.toContain('Alice');
  expect(JSON.stringify(body)).not.toContain('alice@example.com');
  await send({ kind: 'bank-lock' });
  expect((await send({ kind: 'page-restore', texts: ['PERSON_1'] }, page)).error).toMatch(
    /Enable on-page/,
  );
  expect((await send({ kind: 'bank-status' })).entries).toEqual([]);
  expect((await send({ kind: 'scan', text: 'a@example.com' }, page)).safe_to_submit).toBe(false);
  expect(
    (await send({ kind: 'bank-unlock', passphrase: 'a wrong test passphrase' })).error,
  ).toMatch(/Incorrect/);
  expect(await send({ kind: 'bank-unlock', passphrase: 'a private test passphrase' })).toEqual({
    ok: true,
  });
  expect((await send({ kind: 'bank-status' })).entries[0].original).toBe('Alice Tan');
  await send({ kind: 'bank-clear' });
  expect((await send({ kind: 'bank-status' })).entries).toEqual([]);
  expect(stored.encryptedWordBank).toBeUndefined();
  vi.unstubAllGlobals();
});
