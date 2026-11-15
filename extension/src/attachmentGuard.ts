import { contentRuntime } from './contentRuntime';
import { protectAttachment, type ProtectedAttachment } from './attachmentFiles';
import { maxAttachments, type AttachmentPreferences } from './attachmentPolicy';
import { download } from './files';
import type { Scan } from './core';

type Config = AttachmentPreferences & { locked: boolean; session: string; scope: string };
type Batch = {
  controller: AbortController;
  scope: string;
  session: string;
  config?: Config;
  input?: HTMLInputElement;
  target: EventTarget | null;
  trigger: 'input' | 'drop' | 'paste';
  copies: ProtectedAttachment[];
};
const currentScope = () => location.origin + location.pathname;
const ownUI = (element: Element) => !!element.closest('#privruhty-attachments');

/** Independent implementation of hold -> local transform -> protected hand-off. */
export class AttachmentGuard {
  private events = new AbortController();
  private released = new WeakSet<Event>();
  private active: Batch | null = null;
  private invalidated = false;
  private stopped = false;
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private poll: number;

  constructor() {
    // Install synchronously at document_start, before awaiting settings or scans.
    for (const type of ['input', 'change'])
      window.addEventListener(type, this.onInput, { capture: true, signal: this.events.signal });
    window.addEventListener('drop', this.onTransfer, { capture: true, signal: this.events.signal });
    window.addEventListener('paste', this.onTransfer, {
      capture: true,
      signal: this.events.signal,
    });
    window.addEventListener(
      'dragover',
      (event) => {
        if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
      },
      { capture: true, signal: this.events.signal },
    );
    window.addEventListener('pagehide', () => this.destroy(), { signal: this.events.signal });
    this.poll = window.setInterval(() => {
      if (this.active && this.active.scope !== currentScope()) {
        this.cancel();
        this.show(
          'Upload canceled',
          'The chat changed. Drop the file again in the intended conversation.',
        );
      }
    }, 400);
    contentRuntime.onInvalidated(() => {
      this.invalidated = true;
      this.cancel();
      // Keep the early listeners in place until refresh; a stale guard must not
      // silently start allowing original uploads after an extension reload.
      this.show(
        'Refresh to protect attachments',
        'Privruhty updated. Refresh this tab before attaching files.',
      );
    });
  }

  destroy() {
    this.stopped = true;
    this.cancel();
    this.events.abort();
    window.clearInterval(this.poll);
    this.host?.remove();
  }

  private cancel = () => {
    this.active?.controller.abort();
    this.active = null;
  };

  private hold(event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private onInput = (event: Event) => {
    if (this.released.has(event)) return;
    const input = event.composedPath()[0];
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || ownUI(input)) return;
    const files = Array.from(input.files || []);
    // Native pickers emit input then change; we clear the original FileList in
    // the first event so page code cannot read it while an async scan is pending.
    if (!files.length) {
      if (this.active?.input === input) this.hold(event);
      return;
    }
    this.hold(event);
    input.value = '';
    this.begin(files, 'input', input, input);
  };

  private onTransfer = (event: Event) => {
    if (this.released.has(event)) return;
    const transfer =
      event.type === 'drop'
        ? (event as DragEvent).dataTransfer
        : (event as ClipboardEvent).clipboardData;
    const files = Array.from(transfer?.files || []);
    if (!files.length) return; // Plain text pastes/drags retain their normal path.
    const target = event.composedPath()[0] || event.target;
    if (target instanceof Element && ownUI(target)) return;
    this.hold(event);
    if (event.type === 'drop') this.resetDrag(target);
    this.begin(files, event.type as 'drop' | 'paste', target);
  };

  private begin(
    files: File[],
    trigger: Batch['trigger'],
    target: EventTarget | null,
    input?: HTMLInputElement,
  ) {
    this.cancel();
    if (this.invalidated || !contentRuntime.active) {
      this.show('Upload held', 'Refresh this tab to reconnect attachment protection.');
      return;
    }
    const batch: Batch = {
      controller: new AbortController(),
      scope: currentScope(),
      session: '',
      input,
      target,
      trigger,
      copies: [],
    };
    this.active = batch;
    this.show(
      'Checking attachments',
      'The original upload is held. Nothing has been attached by Privruhty yet.',
      batch,
    );
    void this.process(files, batch);
  }

  private assertActive(batch: Batch) {
    batch.controller.signal.throwIfAborted();
    if (this.stopped || this.invalidated || this.active !== batch || batch.scope !== currentScope())
      throw new Error('Upload canceled because the chat or extension changed.');
  }

  private async config(batch: Batch): Promise<Config> {
    const config = await contentRuntime.send({ kind: 'attachment-config' });
    this.assertActive(batch);
    if (
      !config ||
      config.error ||
      typeof config.session !== 'string' ||
      config.scope !== batch.scope
    )
      throw new Error(
        'Upload held. Attachment protection could not connect. Refresh the tab and try again.',
      );
    return config;
  }

  private async process(files: File[], batch: Batch) {
    try {
      const config = await this.config(batch);
      batch.config = config;
      batch.session = config.session;
      if (!config.enabled) {
        const delivered = this.replay(files, batch);
        this.active = null;
        this.show(
          'Attachment protection is off',
          delivered
            ? 'Original files were handed to the website because protection is disabled in Settings.'
            : 'The site did not accept a scripted attachment. Use its file picker. Protection is disabled in Settings.',
        );
        return;
      }
      if (config.locked)
        throw new Error('Upload held. Unlock your word bank, then drop the files again.');
      if (files.length > maxAttachments)
        throw new Error(`Upload held. Attach at most ${maxAttachments} files at a time.`);
      for (let index = 0; index < files.length; index++) {
        this.assertActive(batch);
        this.show(
          'Checking attachments',
          `Scanning file ${index + 1} of ${files.length} locally. The original upload remains held.`,
          batch,
        );
        const protectedFile = await protectAttachment(
          files[index],
          index,
          async (text) => {
            const result = await contentRuntime.send<Scan & { error?: string }>({
              kind: 'scan',
              text,
              attachmentSession: batch.session,
              expectedScope: batch.scope,
            });
            this.assertActive(batch);
            if (!result || result.error || result.scope !== batch.scope)
              throw new Error(
                'Upload held. The scan failed or its workspace changed. Refresh, unlock your bank, and try again.',
              );
            return result;
          },
          batch.controller.signal,
        );
        batch.copies.push(protectedFile);
      }
      this.assertActive(batch);
      if (config.mode === 'review') {
        this.show(
          'Protected copies ready',
          this.summary(batch) +
            ' Attaching can upload these copies immediately. The chat message will not be sent.',
          batch,
          [['Attach protected copies', () => void this.attach(batch)]],
        );
      } else await this.attach(batch);
    } catch (error) {
      if (batch.controller.signal.aborted || this.active !== batch) return;
      this.cancel();
      this.show(
        'Upload held',
        error instanceof Error
          ? error.message
          : 'The files could not be protected. No original was attached.',
      );
    }
  }

  private summary(batch: Batch) {
    const count = batch.copies.reduce((sum, copy) => sum + copy.findings, 0);
    return (
      `${batch.copies.length} checked ${batch.copies.length === 1 ? 'copy' : 'copies'}, ${count} ${count === 1 ? 'replacement' : 'replacements'}. Generic filenames hide source names.` +
      (batch.copies.some((copy) => copy.limited)
        ? ' Limited detection: automatic name detection needs the local service. Review identifying context.'
        : ' Detection can still miss identifying context.')
    );
  }

  private async attach(batch: Batch) {
    try {
      const config = await this.config(batch);
      if (
        !config.enabled ||
        config.locked ||
        config.session !== batch.session ||
        config.mode !== batch.config?.mode
      )
        throw new Error('Upload held. Settings or the word bank changed. Drop the files again.');
      this.assertActive(batch);
      const files = batch.copies.map((copy) => copy.file);
      if (!this.replay(files, batch)) {
        this.show(
          'Download protected copies',
          'The chat did not accept a scripted attachment. Download the checked copies and attach them manually. No original was released.',
          batch,
          [['Download protected copies', () => void this.downloadCopies(batch)]],
        );
        return;
      }
      void contentRuntime.send({ kind: 'protected-applied', scope: batch.scope });
      this.active = null;
      this.show(
        'Checked copies handed to chat',
        this.summary(batch) +
          ' Check the attachment list before sending. The website may upload attachments immediately; Privruhty did not send the chat message.',
      );
    } catch (error) {
      if (batch.controller.signal.aborted || this.active !== batch) return;
      this.cancel();
      this.show(
        'Upload held',
        error instanceof Error ? error.message : 'The attachment could not be protected.',
      );
    }
  }

  private async downloadCopies(batch: Batch) {
    try {
      const config = await this.config(batch);
      if (config.locked || config.session !== batch.session)
        throw new Error('Word bank changed. Drop the files again.');
      for (const copy of batch.copies) download(copy.file, copy.file.name);
      this.cancel();
      this.show(
        'Checked copies downloaded',
        'Review the downloaded copies before attaching. Source files were not changed.',
      );
    } catch {
      if (this.active !== batch || batch.controller.signal.aborted) return;
      this.cancel();
      this.show(
        'Upload held',
        'The review expired. Drop the files again before downloading a protected copy.',
      );
    }
  }

  private dataTransfer(files: File[]) {
    const data = new DataTransfer();
    for (const file of files) data.items.add(file);
    return data;
  }

  private compatible(input: HTMLInputElement, files: File[]) {
    if (
      !input.isConnected ||
      input.disabled ||
      (!input.multiple && files.length > 1) ||
      ownUI(input)
    )
      return false;
    const accept = input.accept
      .toLowerCase()
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return files.every(
      (file) =>
        !accept.length ||
        accept.some((value) =>
          value.startsWith('.')
            ? file.name.toLowerCase().endsWith(value)
            : value.endsWith('/*')
              ? file.type.startsWith(value.slice(0, -1))
              : file.type === value,
        ),
    );
  }

  private replay(files: File[], batch: Batch) {
    this.assertActive(batch);
    const localRoot = batch.target instanceof Element ? batch.target.closest('form,main') : null;
    const candidates = [
      batch.input,
      ...Array.from(
        (localRoot || document).querySelectorAll<HTMLInputElement>('input[type="file"]'),
      ),
      ...Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')),
    ];
    const input = candidates.find(
      (candidate): candidate is HTMLInputElement =>
        !!candidate && this.compatible(candidate, files),
    );
    if (input) {
      try {
        input.files = this.dataTransfer(files).files;
        for (const type of ['input', 'change']) {
          const event = new Event(type, { bubbles: true, composed: true });
          this.released.add(event);
          input.dispatchEvent(event);
        }
        return true;
      } catch {
        return false;
      }
    }
    if (batch.trigger === 'input') return false;
    const composer = document.querySelector<HTMLElement>(
      '#prompt-textarea, form textarea, form [contenteditable="true"], main [contenteditable="true"]',
    );
    const target =
      batch.target instanceof Node && batch.target.isConnected ? batch.target : composer;
    if (!target) return false;
    try {
      const event =
        batch.trigger === 'drop'
          ? new DragEvent('drop', {
              bubbles: true,
              composed: true,
              cancelable: true,
              dataTransfer: this.dataTransfer(files),
            })
          : new ClipboardEvent('paste', {
              bubbles: true,
              composed: true,
              cancelable: true,
              clipboardData: this.dataTransfer(files),
            });
      this.released.add(event);
      target.dispatchEvent(event);
      return event.defaultPrevented;
    } catch {
      return false;
    }
  }

  private resetDrag(target: EventTarget | null) {
    if (!target) return;
    for (const type of ['dragleave', 'dragend'])
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, dataTransfer: new DataTransfer() }),
      );
  }

  private show(
    title: string,
    message: string,
    batch?: Batch,
    actions: [string, () => void][] = [],
  ) {
    if (this.stopped) return;
    if (!document.documentElement) {
      document.addEventListener(
        'DOMContentLoaded',
        () => this.show(title, message, batch, actions),
        { once: true },
      );
      return;
    }
    if (!this.host) {
      this.host = document.createElement('div');
      this.host.id = 'privruhty-attachments';
      this.host.style.cssText =
        'all:initial;position:fixed;right:16px;top:16px;z-index:2147483647;max-width:calc(100vw - 32px);';
      this.root = this.host.attachShadow({ mode: 'open' });
    }
    if (!this.host.isConnected) document.documentElement.append(this.host);
    this.root!.replaceChildren();
    const style = document.createElement('style');
    style.textContent =
      ':host{color-scheme:light}*{box-sizing:border-box}section{font:14px/1.5 system-ui,sans-serif;background:#fcfdfa;color:#203729;border:1px solid #a4bea0;border-radius:12px;padding:16px;width:360px;max-width:calc(100vw - 32px);box-shadow:0 6px 24px #0003}h2{font-size:16px;margin:0 0 8px}p{margin:8px 0}button{font:inherit;min-height:40px;background:#176952;color:#fff;border:1px solid #176952;border-radius:6px;padding:7px 10px;margin:4px 4px 0 0;cursor:pointer}button:focus-visible{outline:3px solid #095ac5;outline-offset:3px}.secondary{background:#edf3eb;color:#203729}';
    const card = document.createElement('section');
    card.setAttribute('aria-label', 'Privruhty attachment protection');
    const heading = document.createElement('h2');
    heading.textContent = title;
    const text = document.createElement('p');
    text.textContent = message;
    text.setAttribute('role', 'status');
    text.setAttribute('aria-live', 'polite');
    text.setAttribute('aria-atomic', 'true');
    card.append(heading, text);
    const button = (label: string, action: () => void, secondary = false) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = label;
      if (secondary) element.className = 'secondary';
      element.onclick = action;
      card.append(element);
    };
    for (const [label, action] of actions) button(label, action);
    if (batch && this.active === batch)
      button(
        'Cancel upload',
        () => {
          this.cancel();
          this.show(
            'Upload canceled',
            'No original or protected file was handed to the website by this review.',
          );
        },
        true,
      );
    else
      button(
        'Close',
        () => {
          this.host?.remove();
        },
        true,
      );
    if (!batch && title === 'Upload held')
      button('Open Documents', () => void contentRuntime.send({ kind: 'open-documents' }), true);
    if (this.invalidated) button('Refresh tab', () => location.reload());
    this.root!.append(style, card);
  }
}
