import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { scan, type Scan } from './core';
import {
  parseDocument,
  exportDocument,
  download,
  encryptFile,
  decryptFile,
  type ParsedDocument,
} from './files';
import { Shell, Empty } from './ui';
import './style.css';
import { VoiceGuard } from './VoiceGuardReview';
function App() {
  const [approved, setApproved] = useState(false);
  const [mode, setMode] = useState('replace'),
    [file, setFile] = useState<File | null>(null),
    [document, setDocument] = useState<ParsedDocument | null>(null),
    [result, setResult] = useState<Scan | null>(null),
    [accepted, setAccepted] = useState<boolean[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [pass, setPass] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [scope, setScope] = useState('');
  const selected =
    result?.spans.map((s, i) => ({
      ...s,
      replacement: accepted[i] ? s.replacement : document!.text.slice(s.start, s.end),
    })) || [];
  let preview = '';
  if (document && result) {
    try {
      preview = exportDocument(document, selected);
    } catch {
      preview = 'Unable to create preview.';
    }
  }
  async function choose(f?: File) {
    if (busy) return;
    setApproved(false);
    setResult(null);
    setDocument(null);
    setMessage('');
    setFile(f || null);
    if (!f) return;
    if (mode !== 'replace') return;
    setBusy(true);
    try {
      if (!/\.(txt|csv)$/i.test(f.name))
        throw new Error(
          'Replacement supports UTF-8 TXT and CSV. Encrypt any other format using the Encrypt tab.',
        );
      if (f.size > 1_000_000) throw new Error('Replacement supports files up to 1 MB.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer());
      const parsed = parseDocument(text, /\.csv$/i.test(f.name)),
        id = 'document:' + crypto.randomUUID();
      setDocument(parsed);
      setScope(id);
      const detected = await scan(parsed.text, id);
      const spans = parsed.cells
        ? detected.spans.filter((s) =>
            parsed.cells!.some((c) => s.start >= c.start && s.end <= c.end),
          )
        : detected.spans;
      const warnings = [...detected.warnings];
      if (spans.length !== detected.spans.length)
        warnings.push('Some findings crossed CSV cell boundaries and need manual review.');
      setResult({
        ...detected,
        spans,
        warnings,
        safe_to_submit: detected.safe_to_submit && spans.length === detected.spans.length,
      });
      setAccepted(spans.map(() => true));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function protect() {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'replace') {
        if (!approved || !document || !result?.safe_to_submit)
          throw new Error('Review the findings before exporting.');
        const output = exportDocument(document, selected);
        download(
          new Blob([output], {
            type: file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : 'text/plain',
          }),
          'protected-' + file.name,
        );
        setMessage('Protected copy downloaded. Your original file is unchanged.');
      } else if (mode === 'encrypt') {
        if (pass !== confirmation) throw new Error('The passphrases do not match.');
        const envelope = await encryptFile(file, pass);
        download(
          new Blob([JSON.stringify(envelope)], { type: 'application/json' }),
          'encrypted-' + crypto.randomUUID().slice(0, 8) + '.pribruhty',
        );
        setPass('');
        setConfirmation('');
        setMessage(
          'Encrypted copy downloaded. Keep the passphrase separately. AI tools cannot read this encrypted file.',
        );
      } else {
        if (file.size > 24_000_000) throw new Error('Encrypted file is too large.');
        const restored = await decryptFile(JSON.parse(await file.text()), pass);
        download(restored.blob, restored.name);
        setPass('');
        setMessage('Original file decrypted locally and downloaded.');
      }
    } catch (e) {
      setMessage(
        mode === 'decrypt'
          ? 'Could not decrypt. Check the passphrase and file.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell
      page="documents"
      title="Protect the file. Preserve the idea."
      description="Create an AI-readable copy with replacements, or encrypt a file for private storage."
    >
      <div className="segmented file-modes">
        {[
          ['replace', 'Replace sensitive text'],
          ['encrypt', 'Encrypt'],
          ['decrypt', 'Decrypt'],
        ].map(([id, name]) => (
          <button
            className={mode === id ? 'selected' : ''}
            key={id}
            onClick={() => {
              setMode(id);
              setFile(null);
              setResult(null);
              setDocument(null);
              setMessage('');
              setPass('');
              setConfirmation('');
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="grid-two">
        <section className="card">
          <span className="step-tag">01 / CHOOSE A FILE</span>
          <h2>
            {mode === 'replace'
              ? 'A protected copy for AI'
              : mode === 'encrypt'
                ? 'A private encrypted copy'
                : 'Recover your original file'}
          </h2>
          <p className="muted">
            {mode === 'replace'
              ? 'TXT and CSV · up to 1 MB · UTF-8'
              : mode === 'encrypt'
                ? 'Any format · up to 10 MB · local AES-GCM encryption'
                : 'Pribruhty encrypted files · passphrase required'}
          </p>
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files[0]);
            }}
          >
            <span className="file-icon">▤</span>
            <strong>
              {busy ? 'Processing locally…' : file?.name || 'Choose a file or drop it here'}
            </strong>
            <small>
              {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Your original stays unchanged'}
            </small>
            <input
              key={mode}
              type="file"
              aria-label="Select document"
              accept={
                mode === 'replace' ? '.txt,.csv' : mode === 'decrypt' ? '.pribruhty' : undefined
              }
              disabled={busy}
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>
          {mode !== 'replace' && (
            <>
              <label>
                File passphrase
                <input
                  type="password"
                  minLength={12}
                  autoComplete="off"
                  placeholder="At least 12 characters"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                />
              </label>
              {mode === 'encrypt' && (
                <label>
                  Confirm passphrase
                  <input
                    type="password"
                    autoComplete="off"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
              )}
              <p className="muted">
                {mode === 'encrypt'
                  ? 'The filename and file contents are encrypted. A lost passphrase cannot be recovered.'
                  : 'Decryption happens here. The passphrase is never stored.'}
              </p>
            </>
          )}
          <button
            className="full-width"
            disabled={
              busy ||
              !file ||
              (mode === 'replace' ? !approved || !result?.safe_to_submit : pass.length < 12)
            }
            onClick={protect}
          >
            {mode === 'replace'
              ? 'Download protected copy'
              : mode === 'encrypt'
                ? 'Encrypt and download'
                : 'Decrypt and download'}
          </button>
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
        </section>
        <section className="card">
          <span className="step-tag">02 / REVIEW THE RESULT</span>
          <h2>{mode === 'replace' ? 'Protected preview' : 'How file encryption works'}</h2>
          {mode === 'replace' ? (
            result ? (
              <>
                <span className="pill">{result.spans.length} findings</span>
                {document?.rows && <span className="pill">{document.rows.length} CSV rows</span>}
                <pre>
                  {preview.slice(0, 18000)}
                  {preview.length > 18000 ? '\n[Preview truncated]' : ''}
                </pre>
                <p className="muted">
                  This is the protected file content. Review exact values and context before
                  uploading. CSV structure is parsed and verified on export; protected numeric cells
                  become text placeholders.
                </p>
                <a
                  className="text-button"
                  href={`wordbank.html?scope=${encodeURIComponent(scope)}`}
                >
                  View this document’s word bank →
                </a>
              </>
            ) : (
              <Empty title="Nothing leaves your device">
                Choose a file to find sensitive text and review the protected copy.
              </Empty>
            )
          ) : (
            <>
              <div className="text-preview">
                Original file → AES-GCM encryption → .pribruhty file
              </div>
              <p>
                Encryption hides the entire file, including its filename. You can decrypt it with
                the same passphrase.
              </p>
              <p className="warning">
                An AI service cannot analyze an encrypted file. Use text replacement to keep useful
                content readable to AI.
              </p>
              <p className="muted">
                Replacement and encryption solve different tasks. Replacement preserves readable
                content with placeholders; encryption protects storage and transfer.
              </p>
            </>
          )}
        </section>
      </div>
      {result && document && mode === 'replace' && (
        <VoiceGuard
          text={document.text}
          result={result}
          accepted={accepted}
          onChange={(values) => {
            setAccepted(values);
            setApproved(false);
          }}
          onApproved={setApproved}
          onScan={() => void choose(file || undefined)}
          onCancel={() => {
            setResult(null);
            setApproved(false);
          }}
        />
      )}
      {result && mode === 'replace' && (
        <details className="card">
          <summary>All replacements (advanced)</summary>
          <h2>Review replacements</h2>
          <div className="findings">
            {result.spans.map((s, i) => (
              <label key={i} className="finding">
                <input
                  type="checkbox"
                  checked={accepted[i]}
                  disabled={s.strategy === 'BLOCK'}
                  onChange={(e) => {
                    setAccepted((a) => a.map((v, j) => (j === i ? e.target.checked : v)));
                    setApproved(false);
                  }}
                />
                <div>
                  <span className="type-label">{s.type.replaceAll('_', ' ')}</span>
                  <div className="change">
                    <span>{document!.text.slice(s.start, s.end)}</span>
                    <span className="change-arrow">→</span>
                    <code>{s.replacement}</code>
                  </div>
                </div>
              </label>
            ))}
          </div>
          {result.warnings.map((w) => (
            <p className="warning" key={w}>
              {w}
            </p>
          ))}
        </details>
      )}
    </Shell>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
