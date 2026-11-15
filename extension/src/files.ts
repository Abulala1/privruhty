import Papa from 'papaparse';
import { apply, type Span } from './core';
import { seal, unseal, toBase64, fromBase64 } from './crypto';
export type Cell = { start: number; end: number; row: number; column: number };
export type ParsedDocument = {
  text: string;
  rows?: string[][];
  cells?: Cell[];
  delimiter?: string;
};
export function parseDocument(text: string, csv: boolean): ParsedDocument {
  if (!csv) return { text };
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, dynamicTyping: false });
  if (parsed.errors.some((e) => e.code !== 'UndetectableDelimiter'))
    throw new Error('CSV could not be parsed. Check its quotes and column structure.');
  const rows = parsed.data;
  const cells: Cell[] = [];
  let combined = '';
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (combined) combined += '\n';
      const start = combined.length;
      combined += cell;
      cells.push({ start, end: combined.length, row: r, column: c });
    }),
  );
  return { text: combined, rows, cells, delimiter: parsed.meta.delimiter || ',' };
}
export function exportDocument(document: ParsedDocument, spans: Span[]): string {
  if (!document.rows || !document.cells) return apply(document.text, spans);
  const output = document.rows.map((row) => [...row]);
  for (const cell of document.cells) {
    const local = spans
      .filter((s) => s.start >= cell.start && s.end <= cell.end)
      .map((s) => ({ ...s, start: s.start - cell.start, end: s.end - cell.start }));
    output[cell.row][cell.column] = apply(output[cell.row][cell.column], local);
  }
  const result = Papa.unparse(output, { delimiter: document.delimiter || ',', newline: '\r\n' });
  const verified = Papa.parse<string[]>(result, { skipEmptyLines: false, dynamicTyping: false });
  if (
    verified.data.length !== output.length ||
    verified.data.some(
      (r, i) => r.length !== output[i].length || r.some((v, j) => v !== output[i][j]),
    )
  )
    throw new Error('CSV export verification failed.');
  return result;
}
export function download(value: Blob, name: string) {
  const url = URL.createObjectURL(value),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function encryptFile(file: File, passphrase: string) {
  if (file.size > 10_000_000) throw new Error('File encryption supports up to 10 MB.');
  return seal(
    { name: file.name, type: file.type, data: toBase64(new Uint8Array(await file.arrayBuffer())) },
    passphrase,
    'file',
  );
}
export async function decryptFile(value: unknown, passphrase: string) {
  const result = await unseal<{ name: string; type: string; data: string }>(
    value,
    passphrase,
    'file',
  );
  if (
    typeof result.name !== 'string' ||
    typeof result.type !== 'string' ||
    typeof result.data !== 'string' ||
    result.data.length > 14_000_000
  )
    throw new Error('Invalid encrypted file.');
  const data = fromBase64(result.data);
  return {
    name: result.name.replace(/[\\/\x00-\x1f]/g, '_'),
    blob: new Blob([data], { type: result.type || 'application/octet-stream' }),
  };
}
