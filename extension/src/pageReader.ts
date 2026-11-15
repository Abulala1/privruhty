import { contentRuntime } from './contentRuntime';
import { textRuns, distributeParts } from './pageText';

const excluded =
  'script,style,noscript,textarea,input,button,select,option,nav,aside,header,[hidden],[aria-hidden="true"],#prompt-textarea,#pribruhty-ui,#pribruhty-suggestion,#pribruhty-page-view,#pribruhty-reload';
const token = /(?<![A-Za-z0-9_])[A-Z][A-Z_]*_\d+(?![A-Za-z0-9_])/;
function excludedNode(node: Text) {
  const element = node.parentElement;
  if (!element || element.closest(excluded)) return true;
  const editable = element.closest('[contenteditable="true"],[role="textbox"]');
  // Generated writing cards are often editable too. Restore their displayed
  // output, but never the prompt composer or a card the user is editing.
  return (
    !!editable &&
    (!editable.closest(
      '[data-message-author-role="assistant"],.font-claude-response,.model-response-text,message-content',
    ) ||
      editable.contains(document.activeElement))
  );
}
type Replacement = { protectedText: string; displayText: string };

/** Opt-in page translation. Originals are visible to the host DOM in this mode. */
export class PageReader {
  private enabled = false;
  private originals = new Map<Text, Replacement>();
  private checked = new WeakMap<Text, string>();
  private toolbar: HTMLDivElement | null = null;
  private toggle: HTMLButtonElement | null = null;
  private feedback: HTMLSpanElement | null = null;
  private timer: number | undefined;
  private generation = 0;
  private scanning = false;
  private dirty = false;
  private path = location.origin + location.pathname;
  private sourceScope = '';
  private bankRevision = -1;
  private syncVersion = 0;
  private destroyed = false;
  private observer: MutationObserver;
  private pollTimer: number;
  private events = new AbortController();

  constructor() {
    this.observer = new MutationObserver((records) => {
      if (!this.enabled) return;
      const changed = records.some((record) => {
        const element =
          record.target instanceof Element ? record.target : record.target.parentElement;
        if (element?.closest('#pribruhty-ui,#pribruhty-suggestion,#pribruhty-page-view'))
          return false;
        if (record.type === 'characterData') {
          const saved = this.originals.get(record.target as Text);
          if (saved && record.target.textContent === saved.displayText) return false;
        }
        return true;
      });
      if (changed) this.schedule();
    });
    this.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.showToolbar();
    this.pollTimer = window.setInterval(() => void this.sync(), 4000);
    addEventListener('pagehide', () => this.disable(), { signal: this.events.signal });
    contentRuntime.onInvalidated(() => this.destroy());
    void this.sync();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer.disconnect();
    window.clearInterval(this.pollTimer);
    this.events.abort();
    this.disable();
    this.toolbar?.remove();
    this.toolbar = null;
  }
  async sync() {
    if (this.destroyed) return;
    const requestVersion = ++this.syncVersion,
      requestedPath = location.origin + location.pathname;
    try {
      const status = await contentRuntime.send({ kind: 'page-view-status' });
      if (this.destroyed || requestVersion !== this.syncVersion) return;
      const path = location.origin + location.pathname;
      if (path !== requestedPath) {
        this.disable();
        this.path = path;
        void this.sync();
        return;
      }
      if (path !== this.path) {
        this.disable();
        this.path = path;
      }
      if (status?.enabled) {
        if (this.sourceScope !== status.sourceScope) {
          this.disable();
          this.sourceScope = status.sourceScope;
        }
        if (this.bankRevision !== status.revision) {
          this.checked = new WeakMap();
          this.bankRevision = status.revision;
        }
        if (!this.enabled) {
          this.enabled = true;
          this.generation++;
          this.checked = new WeakMap();
          this.showToolbar();
        }
        this.schedule();
      } else this.disable();
    } catch {
      this.disable();
    }
  }
  disable() {
    this.enabled = false;
    this.generation++;
    this.syncVersion++;
    window.clearTimeout(this.timer);
    for (const [node, saved] of this.originals) {
      if (!node.isConnected) continue;
      if (node.data === saved.displayText) node.data = saved.protectedText;
      else if (node.data.startsWith(saved.displayText))
        node.data = saved.protectedText + node.data.slice(saved.displayText.length);
    }
    this.originals.clear();
    this.checked = new WeakMap();
    if (!this.destroyed) this.showToolbar();
    this.updateToolbar();
  }
  private updateToolbar() {
    if (!this.toggle) return;
    this.toggle.textContent = this.enabled ? '◉ Show placeholders' : '◉ Show originals';
    this.toggle.setAttribute('aria-label', this.enabled ? 'Show placeholders' : 'Show originals');
    this.toggle.setAttribute('aria-pressed', String(this.enabled));
    this.toggle.title =
      'Show saved original words on this page. This website can read the restored values.';
    const label = this.toolbar?.querySelector('[data-state]');
    if (label) label.textContent = this.enabled ? 'Original words ON' : '';
  }
  private showToolbar() {
    if (this.toolbar) {
      this.updateToolbar();
      return;
    }
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'pribruhty-page-view';
    this.toolbar.setAttribute('aria-label', 'Pribruhty on-page reading mode');
    Object.assign(this.toolbar.style, {
      all: 'initial',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px',
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      maxWidth: 'min(340px, calc(100vw - 32px))',
      zIndex: '2147483645',
      background: '#eff7ea',
      color: '#21452c',
      border: '1px solid #abc79b',
      borderRadius: '16px',
      boxShadow: '0 4px 16px #0003',
      padding: '6px',
      font: '12px/1.4 system-ui',
      colorScheme: 'light',
    });
    const label = document.createElement('span');
    label.textContent = 'Original words ON';
    label.style.color = '#21452c';
    label.title =
      'Display mode: this website can read restored values. Your editable draft is not restored.';
    label.dataset.state = '';
    label.style.padding = '0 4px';
    const off = document.createElement('button');
    off.type = 'button';
    this.toggle = off;
    Object.assign(off.style, {
      background: '#176952',
      color: '#fff',
      border: '0',
      borderRadius: '6px',
      padding: '6px 9px',
      font: '12px system-ui',
      cursor: 'pointer',
    });
    this.feedback = document.createElement('span');
    this.feedback.setAttribute('role', 'status');
    Object.assign(this.feedback.style, {
      display: 'none',
      flexBasis: '100%',
      padding: '4px 7px',
      color: '#21452c',
    });
    off.onclick = async () => {
      off.disabled = true;
      try {
        const result = await contentRuntime.send({ kind: 'page-view-toggle' });
        if (result?.error) {
          this.feedback!.textContent = result.error;
          this.feedback!.style.display = 'block';
          return;
        }
        this.feedback!.style.display = 'none';
        await this.sync();
      } finally {
        off.disabled = false;
      }
    };
    this.toolbar.append(label, off, this.feedback);
    document.documentElement.append(this.toolbar);
    this.updateToolbar();
  }
  private schedule() {
    if (this.destroyed || !this.enabled) return;
    this.dirty = true;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.restore(), 120);
  }
  private async restore() {
    if (this.destroyed || !this.enabled || this.scanning) return;
    if (location.origin + location.pathname !== this.path) {
      this.disable();
      void this.sync();
      return;
    }
    this.scanning = true;
    this.dirty = false;
    const generation = this.generation;
    try {
      for (const node of this.originals.keys()) if (!node.isConnected) this.originals.delete(node);
      const candidates: {
        nodes: Text[];
        before: string[];
        protectedTexts: string[];
        protectedText: string;
      }[] = [];
      let total = 0,
        more = false;
      // Walk the rendered page rather than relying on vendor message selectors;
      // generated cards and portals need the same switching behaviour.
      for (const nodes of textRuns(document.body, excludedNode)) {
        if (nodes.every((node) => this.checked.get(node) === node.data)) continue;
        const before = nodes.map((node) => node.data);
        const protectedTexts = nodes.map((node, index) => {
          const saved = this.originals.get(node),
            value = before[index];
          return saved && value.startsWith(saved.displayText)
            ? saved.protectedText + value.slice(saved.displayText.length)
            : value;
        });
        const protectedText = protectedTexts.join('');
        if (!token.test(protectedText) || protectedText.length > 100_000) {
          nodes.forEach((node) => this.checked.set(node, node.data));
          continue;
        }
        if (candidates.length >= 100 || total + protectedText.length > 180_000) {
          more = true;
          break;
        }
        candidates.push({ nodes, before, protectedTexts, protectedText });
        total += protectedText.length;
      }
      if (!candidates.length) return;
      const result = await contentRuntime.send({
        kind: 'page-restore',
        texts: candidates.map((c) => c.protectedText),
      });
      if (!this.enabled || generation !== this.generation) return;
      if (result?.error || !Array.isArray(result?.texts)) {
        this.disable();
        return;
      }
      if (location.origin + location.pathname !== this.path) {
        this.disable();
        return;
      }
      candidates.forEach((candidate, index) => {
        if (
          candidate.nodes.some(
            (node, i) =>
              !node.isConnected || node.data !== candidate.before[i] || excludedNode(node),
          )
        ) {
          this.dirty = true;
          return;
        }
        if (!Array.isArray(result.parts?.[index])) return;
        const values = distributeParts(candidate.protectedTexts, result.parts[index]);
        candidate.nodes.forEach((node, i) => {
          const displayText = values[i],
            protectedText = candidate.protectedTexts[i];
          if (displayText !== protectedText)
            this.originals.set(node, { protectedText, displayText });
          else this.originals.delete(node);
          node.data = displayText;
          this.checked.set(node, displayText);
        });
      });
      if (this.feedback) {
        const missing = candidates.some(
          (candidate, index) => result.texts[index] === candidate.protectedText,
        );
        this.feedback.textContent = missing
          ? 'Some placeholders have no matching original in this workspace. Check Word bank.'
          : '';
        this.feedback.style.display = missing ? 'block' : 'none';
      }
      if (more) this.dirty = true;
    } catch {
      this.disable();
    } finally {
      this.scanning = false;
      if (this.dirty && this.enabled) this.schedule();
    }
  }
}
