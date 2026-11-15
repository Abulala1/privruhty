import { parseDocument, exportDocument } from './files';
import { maxAttachmentBytes } from './attachmentPolicy';
import type { Scan } from './core';

export type ProtectedAttachment = {
  file: File;
  findings: number;
  categories: string[];
  limited: boolean;
};

/** Reuses Documents' parser/exporter and the service worker's existing mappings. */
export async function protectAttachment(
  file: File,
  index: number,
  scan: (text: string) => Promise<Scan>,
  signal: AbortSignal,
): Promise<ProtectedAttachment> {
  const extension = /\.(txt|csv)$/i.exec(file.name)?.[1].toLowerCase();
  if (!extension)
    throw new Error(
      'Upload held. Automatic replacement supports TXT and CSV only. PDF, Word, images, and other formats were not attached.',
    );
  if (file.size > maxAttachmentBytes)
    throw new Error('Upload held. Each TXT or CSV file must be 1 MB or smaller.');
  signal.throwIfAborted();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error('Upload held. The file could not be read as UTF-8 text.');
  }
  signal.throwIfAborted();
  if (
    /^[\s\uFEFF]*(?:%PDF-|PK\u0003\u0004)/.test(text) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  )
    throw new Error('Upload held. The file contains binary data, not supported plain text.');
  const parsed = parseDocument(text, extension === 'csv');
  const result = await scan(parsed.text);
  signal.throwIfAborted();
  if (!result || !Array.isArray(result.spans) || !result.safe_to_submit)
    throw new Error(
      'Upload held. Unlock your word bank and resolve manual-review warnings in Documents before attaching this file.',
    );
  if (
    result.spans.some(
      (s) =>
        !Number.isInteger(s.start) ||
        !Number.isInteger(s.end) ||
        s.start < 0 ||
        s.end <= s.start ||
        s.end > parsed.text.length ||
        typeof s.replacement !== 'string',
    )
  )
    throw new Error('Upload held. The detector returned invalid replacement ranges.');
  if (
    parsed.cells &&
    result.spans.some(
      (span) => !parsed.cells!.some((cell) => span.start >= cell.start && span.end <= cell.end),
    )
  )
    throw new Error(
      'Upload held. A finding crossed CSV cell boundaries. Review the document separately.',
    );
  const output = exportDocument(parsed, result.spans);
  // Generic names and a fresh timestamp avoid disclosing source-file metadata.
  const copy = new File([output], `protected-document-${index + 1}.${extension}`, {
    type: extension === 'csv' ? 'text/csv' : 'text/plain',
    lastModified: 0,
  });
  return {
    file: copy,
    findings: result.spans.filter((s) => s.replacement !== parsed.text.slice(s.start, s.end))
      .length,
    categories: [...new Set(result.spans.map((s) => s.type))],
    limited: result.warnings.some((w) =>
      /limited detection|fallback|local service unavailable/i.test(w),
    ),
  };
}
