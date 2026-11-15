import { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { scan, apply, type Scan } from './core';
import { request, supportedUrls, scopeFromUrl } from './client';
import type { RestoredPart } from './bank';
import { Shell, Empty, RestoredText } from './ui';
import './style.css';
import { VoiceGuard } from './VoiceGuardReview';

function App() {
  const [approved, setApproved] = useState(false),
    [confirmAction, setConfirmAction] = useState<'copy' | 'insert' | null>(null);
  const [text, setText] = useState(''),
    [result, setResult] = useState<Scan | null>(null),
    [accepted, setAccepted] = useState<boolean[]>([]),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]),
    [target, setTarget] = useState(''),
    [mode, setMode] = useState('protected'),
    [parts, setParts] = useState<RestoredPart[]>([]);
  useEffect(() => {
    chrome.tabs.query({ url: supportedUrls }).then((t) => {
      t.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      setTabs(t);
      if (t[0]?.id) setTarget(String(t[0].id));
    });
  }, []);
  const tab = tabs.find((t) => String(t.id) === target);
  const scope = tab?.url ? scopeFromUrl(tab.url) : 'composer';
  const latest = useRef({ text, scope });
  latest.current = { text, scope };
  const revision = useRef(0);
  const debounceTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    revision.current++;
    setResult(null);
    setParts([]);
    setMode('protected');
    setApproved(false);
    setConfirmAction(null);
    if (!text.trim()) {
      setBusy(false);
      return;
    }
    debounceTimer.current = window.setTimeout(() => {
      void inspect();
    }, 450);
    return () => {
      window.clearTimeout(debounceTimer.current);
      revision.current++;
    };
  }, [text, scope]);
  const preview = result
    ? apply(
        text,
        result.spans.map((s, i) => ({
          ...s,
          replacement: accepted[i] ? s.replacement : text.slice(s.start, s.end),
        })),
      )
    : '';
  async function inspect() {
    setApproved(false);
    setConfirmAction(null);
    window.clearTimeout(debounceTimer.current);
    const requestRevision = ++revision.current;
    setBusy(true);
    setStatus('');
    try {
      const r = await scan(text, scope);
      if (
        requestRevision !== revision.current ||
        latest.current.text !== text ||
        latest.current.scope !== scope
      )
        return;
      setResult(r);
      setAccepted(r.spans.map(() => true));
      setMode('protected');
    } catch (e) {
      if (requestRevision === revision.current) setStatus((e as Error).message);
    } finally {
      if (requestRevision === revision.current) setBusy(false);
    }
  }
  async function insert() {
    if (!approved || !result?.safe_to_submit || !tab?.id) return;
    setStatus('');
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        kind: 'insert',
        text: preview,
        scope,
      });
      if (!response?.ok) throw new Error('Focus the chat editor and try again.');
      await chrome.tabs.update(tab.id, { active: true });
      setStatus('Protected text inserted. Review it before sending.');
    } catch {
      setStatus('Refresh the AI chat tab, focus its message editor, and try again.');
    }
  }
  return (
    <Shell
      page="composer"
      title="A little privacy. A lot of possibility."
      description="Sensitive details are detected as you type. Review suggestions, then approve the protected text."
    >
      <div className="grid-two composer-grid">
        <section className="card">
          <div className="section-heading">
            <h2>Your private draft</h2>
            <span className="pill">Automatic detection on</span>
          </div>
          <label className="field-label">
            Destination
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setResult(null);
                setMode('protected');
              }}
            >
              <option value="">Private composer workspace</option>
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {new URL(t.url!).hostname} · {t.title?.slice(0, 50) || 'AI chat'}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="draft" className="sr-only">
            Private draft
          </label>
          <textarea
            id="draft"
            className="draft-area"
            placeholder="Write an email to Alice Tan at alice@example.com…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
              setParts([]);
            }}
          />
          <div className="section-heading">
            <span className="muted">{text.length.toLocaleString()} characters</span>
            <button disabled={busy || !text.trim()} onClick={inspect}>
              {busy ? 'Reviewing…' : 'Review privacy'}
            </button>
          </div>
        </section>
        <section className="card output-card">
          <div className="section-heading">
            <h2>What the AI will see</h2>
            {result && <span className="pill">{result.spans.length} findings</span>}
          </div>
          {!result ? (
            <Empty title="Your protected draft appears here">
              Start typing. Suggestions appear automatically; your draft stays unchanged until you
              approve insertion.
            </Empty>
          ) : (
            <>
              <div className="segmented">
                <button
                  className={mode === 'protected' ? 'selected' : ''}
                  onClick={() => setMode('protected')}
                >
                  Protected text
                </button>
                <button
                  className={mode === 'original' ? 'selected' : ''}
                  onClick={async () => {
                    try {
                      setParts(await request('restore', { text: preview, scope }));
                      setMode('original');
                    } catch (e) {
                      setStatus((e as Error).message);
                    }
                  }}
                >
                  Original words
                </button>
              </div>
              {mode === 'protected' ? (
                <pre className="text-preview">{preview}</pre>
              ) : (
                <>
                  <p className="muted">
                    Display only. The inserted text still contains placeholders.
                  </p>
                  <RestoredText parts={parts} />
                </>
              )}
              <div className="row">
                <button
                  disabled={!approved || !result.safe_to_submit || !tab}
                  onClick={() => setConfirmAction('insert')}
                >
                  Insert protected text
                </button>
                <button
                  className="secondary"
                  disabled={!approved || !result.safe_to_submit}
                  onClick={() => setConfirmAction('copy')}
                >
                  Copy protected text
                </button>
              </div>
              {confirmAction && (
                <div className="notice" role="group" aria-label="Confirm sharing action">
                  <p>
                    {confirmAction === 'copy'
                      ? 'Copy the approved text to your clipboard?'
                      : 'Insert the approved text into the selected website? The website can read it. Nothing will be submitted.'}
                  </p>
                  <button
                    onClick={async () => {
                      const action = confirmAction;
                      setConfirmAction(null);
                      if (!approved) return;
                      if (action === 'insert') await insert();
                      else
                        await navigator.clipboard
                          .writeText(preview)
                          .then(() => setStatus('Protected text copied.'));
                    }}
                  >
                    Confirm {confirmAction}
                  </button>
                  <button className="secondary" onClick={() => setConfirmAction(null)}>
                    Go back
                  </button>
                </div>
              )}
              {!tab && (
                <p className="muted">
                  Open an AI chat and reload this composer to enable insertion.
                </p>
              )}
              <p className="muted">Pribruhty never submits your message.</p>
            </>
          )}
          {status && (
            <p className="notice" role="status">
              {status}
            </p>
          )}
        </section>
      </div>
      {result && (
        <VoiceGuard
          text={text}
          result={result}
          accepted={accepted}
          onChange={(values) => {
            setAccepted(values);
            setMode('protected');
            setApproved(false);
            setConfirmAction(null);
          }}
          onApproved={setApproved}
          onScan={inspect}
          onCancel={() => {
            setResult(null);
            setApproved(false);
            setConfirmAction(null);
            document.getElementById('draft')?.focus();
          }}
        />
      )}
      {result && (
        <details className="card">
          <summary>All suggested changes (advanced)</summary>
          <div className="section-heading">
            <h2>Suggested changes</h2>
            <span className="eyebrow">{result.task.replace('_', ' ')}</span>
          </div>
          <div className="findings">
            {result.spans.map((s, i) => (
              <label className="finding" key={i}>
                <input
                  type="checkbox"
                  checked={accepted[i]}
                  disabled={s.strategy === 'BLOCK'}
                  onChange={(e) => {
                    setAccepted((a) => a.map((v, j) => (i === j ? e.target.checked : v)));
                    setMode('protected');
                    setApproved(false);
                    setConfirmAction(null);
                  }}
                />
                <div>
                  <span className="type-label">
                    {s.type.replaceAll('_', ' ')} · {Math.round(s.confidence * 100)}%
                  </span>
                  <div className="change">
                    <span>{text.slice(s.start, s.end)}</span>
                    <span className="change-arrow">→</span>
                    <code>{s.replacement}</code>
                  </div>
                  <p className="muted">{s.reason}</p>
                </div>
              </label>
            ))}
          </div>
          {!result.spans.length && (
            <p>
              No structured sensitive information found. Review the draft for identifying context.
            </p>
          )}
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
