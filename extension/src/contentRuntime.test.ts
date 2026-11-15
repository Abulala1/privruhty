import { it, expect, vi } from 'vitest';
import { ContentRuntime } from './contentRuntime';

it('handles synchronous invalidation without an unhandled rejection and cleans up once', async () => {
  const cleanup = vi.fn(),
    send = vi.fn(() => {
      throw new Error('Extension context invalidated.');
    }),
    provider = vi.fn(() => ({ id: 'test', sendMessage: send }));
  const bridge = new ContentRuntime(provider);
  bridge.onInvalidated(cleanup);
  await expect(bridge.send({ kind: 'scan' })).resolves.toBeNull();
  expect(bridge.active).toBe(false);
  expect(cleanup).toHaveBeenCalledTimes(1);
  await expect(bridge.send({ kind: 'scan' })).resolves.toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
it('handles rejected messages and missing runtime IDs after reload', async () => {
  const rejected = new ContentRuntime(() => ({
    id: 'test',
    sendMessage: async () => {
      throw new Error('Extension context invalidated.');
    },
  }));
  const cleanup = vi.fn();
  rejected.onInvalidated(cleanup);
  await expect(rejected.send({})).resolves.toBeNull();
  expect(cleanup).toHaveBeenCalledOnce();
  const missing = new ContentRuntime(() => ({ id: undefined, sendMessage: vi.fn() }));
  expect(missing.active).toBe(false);
  const late = vi.fn();
  missing.onInvalidated(late);
  expect(late).toHaveBeenCalledOnce();
});
it('keeps a valid context usable after a temporary messaging failure', async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('Receiving end does not exist'))
    .mockResolvedValueOnce({ ok: true });
  const bridge = new ContentRuntime(() => ({ id: 'test', sendMessage: send }));
  await expect(bridge.send({})).resolves.toBeNull();
  expect(bridge.active).toBe(true);
  await expect(bridge.send({})).resolves.toEqual({ ok: true });
});
