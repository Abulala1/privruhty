import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { request, scopeLabel, supportedUrls, scopeFromUrl } from './client';
import type { Entry, RestoredPart } from './bank';
import { Shell, RestoredText, Empty } from './ui';
import './style.css';
type Status = { mode: 'temporary' | 'locked' | 'unlocked'; entries: Entry[]; expiresAt: number };
function App() {
  const [state, setState] = useState<Status>({ mode: 'temporary', entries: [], expiresAt: 0 }),
    [pass, setPass] = useState(''),
    [scope, setScope] = useState(
      () => new URLSearchParams(location.search).get('scope') || 'composer',
    ),
    [query, setQuery] = useState(''),
    [original, setOriginal] = useState(''),
    [type, setType] = useState('PERSON'),
    [raw, setRaw] = useState(''),
    [parts, setParts] = useState<RestoredPart[] | null>(null),
    [showOriginal, setShowOriginal] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [openScopes, setOpenScopes] = useState<string[]>([]);
  async function refresh() {
    setState(await request<Status>('bank-status'));
  }
  useEffect(() => {
    chrome.tabs.query({ url: supportedUrls }).then((tabs) => {
      tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      const found = tabs.filter((t) => t.url).map((t) => scopeFromUrl(t.url!));
      setOpenScopes(found);
      if (new URLSearchParams(location.search).has('reader') && found[0]) setScope(found[0]);
    });
  }, []);
  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
    const timer = setInterval(() => refresh().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function readReply() {
    const tabs = await chrome.tabs.query({ url: supportedUrls });
    const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (!tab?.id || !tab.url) throw new Error('Open a supported AI chat first.');
    const response = await chrome.tabs
      .sendMessage(tab.id, { kind: 'read-reply' })
      .catch(() => null);
    if (!response?.text)
      throw new Error('No reply found. Refresh the chat tab or paste its protected reply below.');
    const selected = response.scope || scopeFromUrl(tab.url);
    setScope(selected);
    setRaw(response.text);
    setShowOriginal(true);
    setParts(await request('restore', { text: response.text, scope: selected }));
  }
  const scopes = [
    ...new Set(['composer', scope, ...openScopes, ...state.entries.map((e) => e.scope)]),
  ];
  const visible = state.entries.filter(
    (e) =>
      e.scope === scope &&
      `${e.original} ${e.replacement}`.toLowerCase().includes(query.toLowerCase()),
  );
  const locked = state.mode === 'locked';
  return (
    <Shell
      page="wordbank"
      title="Your words, kept local."
      description="Keep track of replacements and read protected replies with familiar names."
    >
      <section className="card vault-card">
        <div className="section-heading">
          <div>
            <span className={'status-dot ' + (locked ? 'amber' : '')} />
            <strong>
              {locked
                ? 'Word bank locked'
                : state.mode === 'unlocked'
                  ? 'Encrypted word bank unlocked'
                  : 'Temporary word bank'}
            </strong>
            <p className="muted">
              {state.mode === 'temporary'
                ? 'Set a passphrase to save mappings securely across browser restarts. Temporary mappings disappear when the extension worker stops.'
                : `Saved with AES-GCM. Session expires ${new Date(state.expiresAt).toLocaleString()}.`}
            </p>
          </div>
          {state.mode === 'unlocked' && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await request('bank-lock');
                  setParts(null);
                  setRaw('');
                  setOriginal('');
                })
              }
            >
              Lock
            </button>
          )}
        </div>
        {state.mode !== 'unlocked' && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await request('bank-unlock', { passphrase: pass });
                setPass('');
              });
            }}
          >
            <input
              className="grow"
              type="password"
              minLength={12}
              required
              autoComplete="off"
              aria-label="Word bank passphrase"
              placeholder={
                locked ? 'Enter your passphrase' : 'Choose a passphrase · 12+ characters'
              }
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            <button disabled={busy}>{locked ? 'Unlock bank' : 'Encrypt and save'}</button>
          </form>
        )}
      </section>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <label className="field-label">
        Workspace
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setParts(null);
            setShowOriginal(false);
          }}
        >
          {scopes.map((s) => (
            <option key={s} value={s}>
              {scopeLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-two bank-layout">
        <section className="card">
          <div className="section-heading">
            <h2>Word bank</h2>
            <span className="pill">{visible.length} entries</span>
          </div>
          <input
            type="search"
            placeholder="Search names or placeholders"
            aria-label="Search word bank"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {locked ? (
            <Empty title="Unlock to see your words">
              Your original values stay encrypted until you unlock the bank.
            </Empty>
          ) : (
            <>
              <div className="mapping-list">
                {visible.map((e) => (
                  <div className="mapping-row" key={e.id}>
                    <div>
                      <code>{e.replacement}</code>
                      <span className="mapping-original">{e.original}</span>
                    </div>
                    <button
                      className="icon-button"
                      title={`Delete ${e.replacement}`}
                      aria-label={`Delete ${e.replacement}`}
                      onClick={() =>
                        act(async () => {
                          await request('bank-delete', { id: e.id });
                          setParts(null);
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {!visible.length && (
                <p className="muted">
                  Detected values are added here automatically. The same value keeps the same
                  placeholder in this workspace.
                </p>
              )}
              <form
                className="add-term"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await request('bank-add', { original: original.trim(), type, scope });
                    setOriginal('');
                  });
                }}
              >
                <label>
                  Optional: add a term the detector misses
                  <input
                    required
                    maxLength={100}
                    placeholder="e.g. Alice Tan"
                    value={original}
                    onChange={(e) => setOriginal(e.target.value)}
                  />
                </label>
                <div className="row">
                  <select
                    aria-label="Term category"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option>PERSON</option>
                    <option>COMPANY</option>
                    <option>CUSTOM</option>
                  </select>
                  <button disabled={busy}>Add to bank</button>
                </div>
              </form>
            </>
          )}
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>Private reader</h2>
            <span className="pill">Display only</span>
          </div>
          <p className="muted">
            The AI keeps seeing PERSON_1. This extension panel can show Alice. Original names are
            never inserted back into the website.
          </p>
          <button className="secondary" disabled={busy || locked} onClick={() => act(readReply)}>
            Read latest AI reply
          </button>
          <label>
            Protected reply
            <textarea
              placeholder="Paste a reply containing PERSON_1, EMAIL_1…"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setParts(null);
              }}
            />
          </label>
          <div className="row">
            <button
              disabled={busy || locked || !raw}
              onClick={() =>
                act(async () => {
                  setParts(await request('restore', { text: raw, scope }));
                  setShowOriginal(true);
                })
              }
            >
              Show original words
            </button>
            <button className="secondary" onClick={() => setShowOriginal(false)}>
              Show protected text
            </button>
          </div>
          {showOriginal && parts && !locked ? (
            <>
              <div className="preview-label">
                RESTORED VIEW · hover a word to see its placeholder
              </div>
              <RestoredText parts={parts} />
              <button
                className="text-button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(parts.map((p) => p.text).join(''))
                    .then(() => setMessage('Restored text copied. It contains original values.'))
                }
              >
                Copy restored text
              </button>
            </>
          ) : (
            raw && <pre>{raw}</pre>
          )}
        </section>
      </div>
      <div className="row end-row">
        <p className="muted">
          Credentials are removed, never saved or restored. Deleting the bank cannot undo messages
          already sent.
        </p>
        <button
          className="danger text-button"
          onClick={() => {
            if (confirm('Delete this word bank and all saved mappings?'))
              act(async () => {
                await request('bank-clear');
                setParts(null);
                setRaw('');
                setOriginal('');
              });
          }}
        >
          Delete word bank
        </button>
      </div>
    </Shell>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
