import { fallback, apply, type Scan, type Span } from './core';
import { PageReader } from './pageReader';
import { contentRuntime } from './contentRuntime';
import { mountVoiceGuard } from './inlineVoiceGuard';
let unmountVoiceGuard: (() => void) | null = null;
function clearVoiceGuard() {
  unmountVoiceGuard?.();
  unmountVoiceGuard = null;
}
const contentEvents = new AbortController();
let disposed = false;
const pageReader = new PageReader();

const highlightName = 'pribruhty-sensitive';
const style = document.createElement('style');
style.textContent = `::highlight(${highlightName}){background-color:#ffd166;color:#241900;text-decoration:underline;text-decoration-color:#9b4800;text-decoration-thickness:2px}`;
document.documentElement.append(style);

let editor: HTMLElement | null = null;
let shield: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let popup: HTMLDivElement | null = null;
let current: Scan | null = null;
let source = '';
let selected: boolean[] = [];
let dismissed = false;
let timer: number | undefined;
let hoverTimer: number | undefined;
let hideTimer: number | undefined;
let hoverIndex = -1;
let pendingIndex = -1;
let hits: { range: Range; index: number }[] = [];
let manualPosition: { x: number; y: number } | null = null;
let dragging = false;
const ignored = new Set<number>();

function css(element: HTMLElement, values: Partial<CSSStyleDeclaration>) {
  Object.assign(element.style, values);
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, parent: HTMLElement) {
  const element = document.createElement(tag);
  element.textContent = text;
  css(element, { font: 'inherit', color: 'inherit', boxSizing: 'border-box' });
  parent.append(element);
  return element;
}
function actionButton(text: string, parent: HTMLElement, secondary = false) {
  const button = node('button', text, parent);
  button.type = 'button';
  css(button, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: secondary ? '#edf3eb' : '#176952',
    color: secondary ? '#31533b' : '#fff',
    border: secondary ? '1px solid #d9e5d3' : '1px solid #176952',
    borderRadius: '7px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
    lineHeight: '1.4',
    textAlign: 'center',
    boxShadow: 'none',
  });
  return button;
}
function baseCard(card: HTMLElement) {
  css(card, {
    all: 'initial',
    display: 'block',
    boxSizing: 'border-box',
    position: 'fixed',
    zIndex: '2147483647',
    background: '#fcfdfa',
    color: '#273e2d',
    colorScheme: 'light',
    border: '1px solid #cfdcc7',
    borderRadius: '12px',
    boxShadow: '0 8px 32px #101b1830',
    padding: '16px',
    font: '13px/1.5 system-ui',
    overflowWrap: 'anywhere',
  });
}
function isOwnUI(element: Element) {
  return !!element.closest('#pribruhty-ui,#pribruhty-suggestion,#pribruhty-page-view');
}
function isEditor(element: Element) {
  return (
    element.matches('textarea,[contenteditable="true"],[role="textbox"]') &&
    !isOwnUI(element) &&
    !element.closest(
      '[data-message-author-role="assistant"],.font-claude-response,.model-response-text,message-content',
    )
  );
}
function findEditor() {
  const active = document.activeElement;
  if (active && isEditor(active)) return active as HTMLElement;
  if (editor && document.contains(editor)) return editor;
  return [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].find(
    isEditor,
  ) as HTMLElement | undefined;
}
function value(element: HTMLElement) {
  return element instanceof HTMLTextAreaElement ? element.value : element.innerText || '';
}
function clearHighlights() {
  hits = [];
  (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights?.delete(highlightName);
}
function hidePopup() {
  clearTimeout(hoverTimer);
  clearTimeout(hideTimer);
  pendingIndex = -1;
  hoverIndex = -1;
  popup?.remove();
  popup = null;
}
function closeReview() {
  clearVoiceGuard();
  dismissed = true;
  panel?.remove();
  panel = null;
}
function setValue(element: HTMLElement, text: string) {
  element.focus();
  if (element instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      element,
      text,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    element.textContent = text;
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
    const selection = getSelection();
    selection?.selectAllChildren(element);
    selection?.collapseToEnd();
  }
}

function highlight() {
  clearHighlights();
  if (!editor || !current || editor instanceof HTMLTextAreaElement) return;
  const registry = (CSS as typeof CSS & { highlights?: Map<string, unknown> }).highlights;
  const ctor = (window as Window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !ctor) return;
  // Align DOM offsets with rendered text, including collapsed whitespace and
  // paragraph breaks. Changing one item must not break the remaining highlights.
  const segments: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let raw = '';
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text,
      data = textNode.data;
    if (!data) continue;
    const testRange = document.createRange();
    testRange.selectNodeContents(textNode);
    if (!testRange.getClientRects().length) continue;
    const start = raw.length;
    raw += data;
    segments.push({ node: textNode, start, end: raw.length });
  }
  const needed = new Set(current.spans.flatMap((s) => [s.start, s.end - 1]));
  const offsets = new Map<number, number>();
  let renderedAt = 0,
    rawAt = 0;
  while (renderedAt < source.length && rawAt < raw.length) {
    const renderedChar = source[renderedAt],
      rawChar = raw[rawAt];
    if (renderedChar === rawChar || (/\s/.test(renderedChar) && /\s/.test(rawChar))) {
      if (needed.has(renderedAt)) offsets.set(renderedAt, rawAt);
      renderedAt++;
      rawAt++;
    } else if (/\s/.test(rawChar)) rawAt++;
    else if (/\s/.test(renderedChar)) renderedAt++;
    else break;
  }
  current.spans.forEach((span, index) => {
    if (ignored.has(index)) return;
    const from = offsets.get(span.start),
      last = offsets.get(span.end - 1);
    if (from === undefined || last === undefined) return;
    const to = last + 1;
    const start = segments.find((s) => from >= s.start && from < s.end);
    const end = segments.find((s) => to > s.start && to <= s.end);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(start.node, from - start.start);
    range.setEnd(end.node, to - end.start);
    // Never highlight unrelated text when the host editor uses unusual whitespace.
    if (
      range.toString().replace(/\s+/g, ' ') !==
      source.slice(span.start, span.end).replace(/\s+/g, ' ')
    )
      return;
    hits.push({ range, index });
  });
  if (hits.length) registry.set(highlightName, new ctor(...hits.map((h) => h.range)));
}

function clampPoint(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(8, Math.min(innerWidth - width - 8, x)),
    y: Math.max(8, Math.min(innerHeight - height - 8, y)),
  };
}
function movePanel(x: number, y: number) {
  if (!panel) return;
  const rect = panel.getBoundingClientRect(),
    point = clampPoint(x, y, rect.width, rect.height);
  manualPosition = point;
  panel.style.left = point.x + 'px';
  panel.style.top = point.y + 'px';
}
function position() {
  if (!editor) return;
  const rect = editor.getBoundingClientRect();
  if (shield) {
    shield.style.left = Math.max(8, Math.min(innerWidth - 60, rect.right - 44)) + 'px';
    shield.style.top = Math.max(8, Math.min(innerHeight - 46, rect.top - 42)) + 'px';
    shield.hidden = !value(editor).trim();
  }
  if (panel && !dragging) {
    const width = Math.min(370, innerWidth - 24);
    panel.style.width = width + 'px';
    panel.style.maxHeight = Math.min(innerHeight - 24, Math.round(innerHeight * 0.72)) + 'px';
    if (manualPosition) {
      movePanel(manualPosition.x, manualPosition.y);
      return;
    }
    const right = innerWidth - rect.right;
    const x =
      right >= width + 12
        ? rect.right + 10
        : rect.left >= width + 12
          ? rect.left - width - 10
          : rect.left;
    const y = right >= width + 12 || rect.left >= width + 12 ? rect.top : rect.bottom + 10;
    const point = clampPoint(x, y, width, panel.getBoundingClientRect().height);
    panel.style.left = point.x + 'px';
    panel.style.top = point.y + 'px';
  }
}
function makeDraggable(handle: HTMLButtonElement) {
  handle.setAttribute('aria-label', 'Move review panel');
  handle.title = 'Drag to move. Arrow keys also move the panel.';
  css(handle, { cursor: 'grab', touchAction: 'none', userSelect: 'none' });
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !panel) return;
    event.preventDefault();
    hidePopup();
    dragging = true;
    handle.style.cursor = 'grabbing';
    const rect = panel.getBoundingClientRect(),
      startX = event.clientX,
      startY = event.clientY;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) =>
      movePanel(rect.left + next.clientX - startX, rect.top + next.clientY - startY);
    const end = () => {
      dragging = false;
      handle.style.cursor = 'grab';
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      if (panel) showReview();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('keydown', (event) => {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta || !panel) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect(),
      step = event.shiftKey ? 30 : 10;
    movePanel(rect.left + delta[0] * step, rect.top + delta[1] * step);
  });
}
function mount() {
  if (shield) return;
  shield = document.createElement('button');
  shield.type = 'button';
  shield.textContent = '🛡';
  shield.title = 'Pribruhty review';
  shield.setAttribute('aria-label', 'Open Pribruhty review');
  css(shield, {
    position: 'fixed',
    zIndex: '2147483646',
    background: '#176952',
    color: '#fff',
    border: '1px solid #8db9a4',
    borderRadius: '24px',
    width: '40px',
    height: '38px',
    cursor: 'pointer',
    boxShadow: '0 4px 16px #0003',
    font: '14px system-ui',
  });
  shield.onclick = () => {
    dismissed = false;
    showReview();
  };
  document.documentElement.append(shield);
}
function markedPreview(parent: HTMLElement, text: string, spans: Span[]) {
  parent.replaceChildren();
  let cursor = 0;
  spans.forEach((span, index) => {
    parent.append(document.createTextNode(text.slice(cursor, span.start)));
    const mark = node(
      'mark',
      selected[index] ? span.replacement : text.slice(span.start, span.end),
      parent,
    );
    css(mark, {
      background: selected[index] ? '#c7e8b7' : '#ffdc80',
      color: '#19321d',
      borderRadius: '3px',
      padding: '1px 3px',
    });
    cursor = span.end;
  });
  parent.append(document.createTextNode(text.slice(cursor)));
}
function applyApproved(spans: Span[], expected: string) {
  if (disposed || !contentRuntime.active) return;
  if (!editor || value(editor) !== expected) {
    hidePopup();
    closeReview();
    void inspect();
    return;
  }
  if (!current?.safe_to_submit) {
    alert(current?.warnings.at(-1) || 'Review the draft before applying changes.');
    return;
  }
  const next = apply(expected, spans);
  void contentRuntime.send({ kind: 'protected-applied', scope: current.scope });
  if (disposed) return;
  clearVoiceGuard();
  hidePopup();
  panel?.remove();
  panel = null;
  clearHighlights();
  source = '';
  current = null;
  selected = [];
  ignored.clear();
  setValue(editor, next);
}

function showReview() {
  if (disposed || !editor || dragging) return;
  const text = value(editor);
  if (text !== source || !current) return;
  clearVoiceGuard();
  panel?.remove();
  panel = document.createElement('div');
  panel.id = 'pribruhty-ui';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Pribruhty privacy review');
  baseCard(panel);
  css(panel, { overflowY: 'auto' });
  document.documentElement.append(panel);
  const result = current;
  const voice = actionButton('Accessible VoiceGuard review', panel, true);
  voice.onclick = () => {
    if (!panel) return;
    panel.replaceChildren();
    const host = node('div', '', panel),
      shadow = host.attachShadow({ mode: 'open' }),
      container = document.createElement('div');
    shadow.append(container);
    unmountVoiceGuard = mountVoiceGuard(
      container,
      text,
      result,
      selected,
      (values) => {
        selected = values;
        highlight();
      },
      (values) =>
        applyApproved(
          result.spans.map((span, index) => ({
            ...span,
            replacement:
              span.strategy === 'BLOCK' || values[index]
                ? span.replacement
                : text.slice(span.start, span.end),
          })),
          text,
        ),
      closeReview,
      () => {
        source = '';
        clearVoiceGuard();
        void inspect();
      },
    );
    position();
  };
  const header = node('div', '', panel);
  css(header, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderBottom: '1px solid #e0e8db',
    paddingBottom: '10px',
    marginBottom: '10px',
  });
  const handle = node('button', `⠿  Pribruhty · ${result.spans.length} suggestions`, header);
  handle.type = 'button';
  css(handle, {
    flex: '1',
    display: 'block',
    background: 'transparent',
    border: '0',
    padding: '4px 0',
    textAlign: 'left',
    fontSize: '14px',
    fontWeight: '650',
    lineHeight: '1.4',
    color: '#29492e',
  });
  makeDraggable(handle);
  const close = node('button', '×', header);
  close.type = 'button';
  close.setAttribute('aria-label', 'Close suggestions');
  css(close, {
    background: 'transparent',
    border: '0',
    padding: '0 4px',
    fontSize: '22px',
    color: '#476348',
    cursor: 'pointer',
  });
  close.onclick = closeReview;
  const intro = node(
    'p',
    'Hover a highlighted word for its suggestion. Drag this header to move the box.',
    panel,
  );
  css(intro, { fontSize: '11px', color: '#64775c', margin: '0 0 10px' });
  const list = node('div', '', panel);
  result.spans.forEach((span, index) => {
    const card = node('div', '', list);
    css(card, {
      border: '1px solid #d9e5d2',
      borderRadius: '8px',
      padding: '10px',
      margin: '8px 0',
      background: '#f6f9f2',
    });
    const label = node(
      'strong',
      `${span.type.replaceAll('_', ' ')} · ${Math.round(span.confidence * 100)}%`,
      card,
    );
    css(label, { fontSize: '11px', display: 'block', color: '#58734d' });
    const change = node('div', `${text.slice(span.start, span.end)} → ${span.replacement}`, card);
    css(change, { fontWeight: '600', margin: '5px 0', color: '#203e26' });
    const reason = node('small', span.reason, card);
    css(reason, { display: 'block', fontSize: '11px', color: '#62735b', marginBottom: '7px' });
    const control = actionButton(
      span.strategy === 'BLOCK'
        ? 'Secret will be removed'
        : selected[index]
          ? 'Keep original'
          : 'Include change',
      card,
      true,
    );
    control.disabled = span.strategy === 'BLOCK';
    control.onclick = () => {
      selected[index] = !selected[index];
      if (selected[index]) ignored.delete(index);
      else ignored.add(index);
      highlight();
      showReview();
    };
  });
  if (!result.spans.length)
    node('p', 'No findings in this draft. Review sensitive context before sending.', list);
  const label = node('strong', 'Proposed text', panel);
  css(label, { display: 'block', fontSize: '12px', marginTop: '12px' });
  const preview = node('div', '', panel);
  css(preview, {
    whiteSpace: 'pre-wrap',
    color: '#29492e',
    padding: '11px',
    background: '#edf4e8',
    border: '1px solid #dde9d5',
    borderRadius: '8px',
    marginTop: '6px',
  });
  markedPreview(preview, text, result.spans);
  for (const warning of result.warnings) {
    const note = node('p', warning, panel);
    css(note, {
      fontSize: '11px',
      background: '#fff1cd',
      color: '#70521c',
      padding: '9px',
      borderRadius: '7px',
      margin: '10px 0',
    });
  }
  const approve = actionButton('Apply selected changes', panel);
  approve.disabled = !result.safe_to_submit;
  css(approve, { marginTop: '12px', opacity: approve.disabled ? '.5' : '1' });
  approve.onclick = () =>
    applyApproved(
      result.spans.map((span, index) => ({
        ...span,
        replacement: selected[index] ? span.replacement : text.slice(span.start, span.end),
      })),
      text,
    );
  const footer = node(
    'p',
    'Changes need your approval. Pribruhty never sends your message.',
    panel,
  );
  css(footer, { fontSize: '11px', color: '#6b7c61', margin: '10px 0 0' });
  const bank = actionButton('Word bank & private reader', panel, true);
  css(bank, { marginTop: '8px', fontSize: '11px' });
  bank.onclick = () => {
    void contentRuntime.send({ kind: 'open-bank' });
  };
  position();
}

function hitAt(x: number, y: number) {
  if (!editor || !current || value(editor) !== source) return;
  const under = document.elementFromPoint(x, y);
  if (!under || !editor.contains(under)) return;
  const editorRect = editor.getBoundingClientRect();
  if (x < editorRect.left || x > editorRect.right || y < editorRect.top || y > editorRect.bottom)
    return;
  for (const hit of hits)
    for (const rect of hit.range.getClientRects())
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
        return { index: hit.index, rect };
}
function showSuggestion(index: number, anchor: DOMRect) {
  if (disposed || !current || !editor || value(editor) !== source || ignored.has(index)) return;
  hidePopup();
  hoverIndex = index;
  const span = current.spans[index],
    text = source;
  popup = document.createElement('div');
  popup.id = 'pribruhty-suggestion';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Pribruhty suggestion');
  baseCard(popup);
  css(popup, {
    width: Math.min(320, innerWidth - 24) + 'px',
    zIndex: '2147483647',
    maxHeight: 'calc(100vh - 24px)',
    overflowY: 'auto',
  });
  const label = node('div', `${span.type.replaceAll('_', ' ')} · Privacy suggestion`, popup);
  css(label, { fontSize: '10px', fontWeight: '700', letterSpacing: '.4px', color: '#66805b' });
  const original = node('div', text.slice(span.start, span.end), popup);
  css(original, { fontSize: '14px', fontWeight: '600', margin: '7px 0 3px', color: '#374b30' });
  const replacement = node('div', '→ ' + span.replacement, popup);
  css(replacement, { fontSize: '15px', fontWeight: '650', color: '#176144', marginBottom: '8px' });
  const reason = node('p', span.reason, popup);
  css(reason, { fontSize: '11px', color: '#65775c', margin: '0 0 11px' });
  const buttons = node('div', '', popup);
  css(buttons, { display: 'flex', gap: '7px', flexWrap: 'wrap' });
  const accept = actionButton(
    span.strategy === 'BLOCK' ? 'Remove secret' : 'Accept change',
    buttons,
  );
  accept.disabled = !current.safe_to_submit;
  css(accept, { opacity: accept.disabled ? '.5' : '1' });
  accept.onclick = () => applyApproved([span], text);
  if (span.strategy !== 'BLOCK') {
    const keep = actionButton('Keep original', buttons, true);
    keep.onclick = () => {
      selected[index] = false;
      ignored.add(index);
      hidePopup();
      highlight();
      if (panel) showReview();
    };
  }
  if (!current.safe_to_submit) {
    const warning = node(
      'p',
      current.warnings.at(-1) || 'Review required before applying changes.',
      popup,
    );
    css(warning, { fontSize: '11px', color: '#8b651e', margin: '8px 0 0' });
  }
  popup.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  popup.addEventListener('pointerleave', scheduleHide);
  document.documentElement.append(popup);
  const rect = popup.getBoundingClientRect(),
    preferredY = anchor.bottom + 8;
  const y = preferredY + rect.height > innerHeight - 8 ? anchor.top - rect.height - 8 : preferredY;
  let x = anchor.left;
  // Keep the hover card clear of the larger review panel when possible.
  if (panel) {
    const p = panel.getBoundingClientRect();
    if (x < p.right && x + rect.width > p.left && y < p.bottom && y + rect.height > p.top) {
      if (p.left - rect.width - 10 >= 8) x = p.left - rect.width - 10;
      else if (p.right + rect.width + 10 < innerWidth) x = p.right + 10;
    }
  }
  const point = clampPoint(x, y, rect.width, rect.height);
  popup.style.left = point.x + 'px';
  popup.style.top = point.y + 'px';
}
function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hidePopup, 240);
}
document.addEventListener(
  'pointermove',
  (event) => {
    if (dragging || event.buttons) return;
    if (event.target instanceof Element && event.target.closest('#pribruhty-suggestion')) {
      clearTimeout(hideTimer);
      return;
    }
    const hit = hitAt(event.clientX, event.clientY);
    if (!hit) {
      clearTimeout(hoverTimer);
      pendingIndex = -1;
      if (popup) scheduleHide();
      return;
    }
    clearTimeout(hideTimer);
    if (hoverIndex === hit.index || pendingIndex === hit.index) return;
    clearTimeout(hoverTimer);
    pendingIndex = hit.index;
    hoverTimer = window.setTimeout(() => showSuggestion(hit.index, hit.rect), 160);
  },
  { capture: true, signal: contentEvents.signal },
);
document.addEventListener(
  'click',
  (event) => {
    const hit = hitAt(event.clientX, event.clientY);
    if (hit) showSuggestion(hit.index, hit.rect);
  },
  { capture: true, signal: contentEvents.signal },
);
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape') {
      if (popup) hidePopup();
      else if (panel) closeReview();
    }
  },
  { capture: true, signal: contentEvents.signal },
);

async function inspect() {
  if (disposed || !contentRuntime.active) return;
  const next = findEditor();
  if (!next) return;
  if (editor !== next) {
    dismissed = false;
    source = '';
    current = null;
    hidePopup();
    clearHighlights();
  }
  editor = next;
  mount();
  position();
  const text = value(editor);
  if (text === source) return;
  source = text;
  current = null;
  ignored.clear();
  hidePopup();
  clearHighlights();
  if (!text.trim()) {
    clearVoiceGuard();
    dismissed = false;
    panel?.remove();
    panel = null;
    return;
  }
  const remote = await contentRuntime.send({ kind: 'scan', text });
  if (disposed || editor !== next || text !== value(next)) return;
  current = remote && !remote.error ? remote : fallback(text);
  if (remote?.error) current!.warnings.push(remote.error);
  selected = current!.spans.map(() => true);
  shield!.textContent = current!.spans.length ? '🛡 ' + current!.spans.length : '🛡';
  shield!.style.width = current!.spans.length ? '52px' : '40px';
  highlight();
  if (panel || (current!.spans.length && !dismissed)) showReview();
}
function scheduleScan() {
  if (disposed || !contentRuntime.active) return;
  clearTimeout(timer);
  timer = window.setTimeout(inspect, 350);
}
document.addEventListener(
  'input',
  (event) => {
    if (event.target instanceof Element && !isOwnUI(event.target)) {
      hidePopup();
      clearHighlights();
      scheduleScan();
    }
  },
  { capture: true, signal: contentEvents.signal },
);
document.addEventListener(
  'focusin',
  (event) => {
    if (event.target instanceof Element && isEditor(event.target)) {
      clearTimeout(timer);
      timer = window.setTimeout(inspect, 100);
    }
  },
  { capture: true, signal: contentEvents.signal },
);
const hostObserver = new MutationObserver(() => {
  if (editor && !document.contains(editor)) {
    clearVoiceGuard();
    editor = null;
    source = '';
    current = null;
    shield?.remove();
    shield = null;
    panel?.remove();
    panel = null;
    hidePopup();
    clearHighlights();
  }
  position();
});
hostObserver.observe(document.documentElement, { subtree: true, childList: true });
addEventListener(
  'scroll',
  () => {
    hidePopup();
    position();
  },
  { capture: true, signal: contentEvents.signal },
);
addEventListener(
  'resize',
  () => {
    hidePopup();
    position();
  },
  { signal: contentEvents.signal },
);
const receiveMessage = (
  message: any,
  _sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void,
) => {
  if (message?.kind === 'page-view-changed') {
    if (message.enabled) void pageReader.sync();
    else pageReader.disable();
    reply({ ok: true });
    return;
  }
  if (message?.kind === 'insert') {
    const target = findEditor();
    if (target) {
      void contentRuntime.send({ kind: 'protected-applied', scope: message.scope });
      setValue(target, message.text);
      reply({ ok: true });
    } else reply({ ok: false });
  }
  if (message?.kind === 'read-reply') {
    const selectors = [
      '[data-message-author-role="assistant"]',
      '.font-claude-response',
      'message-content',
      '.model-response-text',
    ];
    const latest = [...document.querySelectorAll(selectors.join(','))]
      .filter((el) => !isOwnUI(el))
      .at(-1) as HTMLElement | undefined;
    reply({ text: latest?.innerText?.slice(0, 100000) || '', scope: current?.scope });
  }
};

contentRuntime.onInvalidated(() => {
  if (disposed) return;
  disposed = true;
  clearVoiceGuard();
  contentEvents.abort();
  hostObserver.disconnect();
  clearTimeout(timer);
  hidePopup();
  clearHighlights();
  pageReader.destroy();
  panel?.remove();
  panel = null;
  shield?.remove();
  shield = null;
  style.remove();
  current = null;
  source = '';
  editor = null;
  if (!document.getElementById('pribruhty-reload')) {
    const notice = document.createElement('div');
    notice.id = 'pribruhty-reload';
    notice.setAttribute('role', 'status');
    css(notice, {
      all: 'initial',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      maxWidth: 'calc(100vw - 32px)',
      zIndex: '2147483647',
      boxSizing: 'border-box',
      background: '#f5f9f0',
      color: '#29432f',
      border: '1px solid #b7cbae',
      borderRadius: '10px',
      padding: '11px 14px',
      font: '12px/1.5 system-ui',
      boxShadow: '0 4px 16px #0003',
    });
    node('span', 'Pribruhty updated. Refresh this tab to reconnect.', notice);
    const refresh = actionButton('Refresh tab', notice);
    refresh.onclick = () => location.reload();
    document.documentElement.append(notice);
  }
});
if (contentRuntime.active) {
  try {
    chrome.runtime.onMessage.addListener(receiveMessage);
  } catch {
    contentRuntime.invalidate();
  }
}
