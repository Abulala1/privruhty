import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { parseDocument, exportDocument } from './files';
import { fallback } from './core';
describe('structured document replacement', () => {
  it('preserves CSV cells, commas, quotes and multiline values', () => {
    const input =
      'name,email,note\r\n"Tan, Alice",alice@example.com,"hello\r\nworld"\r\nBob,bob@example.com,"says ""hello"""';
    const doc = parseDocument(input, true),
      result = fallback(doc.text);
    const output = exportDocument(doc, result.spans),
      rows = Papa.parse<string[]>(output).data;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(['Tan, Alice', 'EMAIL_1', 'hello\r\nworld']);
    expect(rows[2]).toEqual(['Bob', 'EMAIL_2', 'says "hello"']);
  });
  it('preserves malicious text as data and blocks malformed CSV', () => {
    const raw = '<script>alert("x")</script> a@example.com';
    const doc = parseDocument(raw, false);
    expect(exportDocument(doc, fallback(raw).spans)).toBe('<script>alert("x")</script> EMAIL_1');
    expect(() => parseDocument('a,b\n"broken,quote', true)).toThrow();
  });
});
