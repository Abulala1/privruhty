import type { RestoredPart } from './bank';

// Collect contiguous inline text as a unit, like a page translator. A token may
// span <strong>, <span>, or browser-translation <font> elements.
export function textRuns(root: Element, excluded: (node: Text) => boolean): Text[][] {
  const runs: Text[][] = [];
  let run: Text[] = [];
  const flush = () => {
    if (run.length) runs.push(run);
    run = [];
  };
  const visit = (node: Node) => {
    if (node instanceof Text) {
      if (excluded(node)) flush();
      else run.push(node);
      return;
    }
    if (!(node instanceof Element)) return;
    const display = getComputedStyle(node).display;
    const block =
      node.tagName === 'BR' ||
      !['inline', 'contents', 'inline-block', 'inline-flex'].includes(display);
    if (block) flush();
    for (const child of node.childNodes) visit(child);
    if (block) flush();
  };
  visit(root);
  flush();
  return runs;
}

export function distributeParts(texts: string[], parts: RestoredPart[]): string[] {
  const edits: { start: number; end: number; text: string }[] = [];
  let at = 0;
  for (const part of parts) {
    const length = part.placeholder?.length ?? part.text.length;
    if (part.placeholder) edits.push({ start: at, end: at + length, text: part.text });
    at += length;
  }
  let offset = 0;
  return texts.map((text) => {
    const start = offset,
      end = start + text.length;
    offset = end;
    let result = text;
    for (const edit of [...edits].reverse()) {
      if (edit.start >= end || edit.end <= start) continue;
      const left = Math.max(0, edit.start - start),
        right = Math.min(text.length, edit.end - start);
      result = result.slice(0, left) + (edit.start >= start ? edit.text : '') + result.slice(right);
    }
    return result;
  });
}
