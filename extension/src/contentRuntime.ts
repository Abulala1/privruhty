type RuntimeApi = { id?: string; sendMessage: (message: unknown) => Promise<unknown> };
export class ContentRuntime {
  private stopped = false;
  private listeners = new Set<() => void>();
  constructor(private provider: () => RuntimeApi | undefined) {}
  get active() {
    if (this.stopped) return false;
    try {
      if (this.provider()?.id) return true;
    } catch {}
    this.invalidate();
    return false;
  }
  onInvalidated(callback: () => void) {
    if (this.stopped) {
      try {
        callback();
      } catch {}
      return () => {};
    }
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  invalidate() {
    if (this.stopped) return;
    this.stopped = true;
    for (const callback of this.listeners) {
      try {
        callback();
      } catch {}
    }
    this.listeners.clear();
  }
  async send<T = any>(message: unknown): Promise<T | null> {
    if (!this.active) return null;
    try {
      // A stale runtime can throw BEFORE returning a Promise. Appending .catch()
      // to sendMessage alone does not catch that synchronous exception.
      return (await this.provider()!.sendMessage(message)) as T;
    } catch (error) {
      if (
        /extension context invalidated|context invalidated|extension has been invalidated/i.test(
          error instanceof Error ? error.message : String(error),
        )
      )
        this.invalidate();
      else void this.active;
      return null;
    }
  }
}
export const contentRuntime = new ContentRuntime(() =>
  typeof chrome === 'undefined' ? undefined : (chrome.runtime as RuntimeApi),
);
