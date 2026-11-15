import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Shield } from './ui';
import { request, scopeLabel } from './client';
import './style.css';
type PageInfo = { enabled: boolean; locked: boolean; scopes: string[]; sourceScope: string };
function App() {
  const [site, setSite] = useState('Checking current tab…'),
    [tabId, setTabId] = useState<number>(),
    [info, setInfo] = useState<PageInfo | null>(null),
    [sourceScope, setSourceScope] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      const host = tab?.url?.match(/^https:\/\/(chatgpt\.com|claude\.ai|gemini\.google\.com)/)?.[1];
      setSite(host || 'Open ChatGPT, Claude, or Gemini');
      if (host && tab.id) {
        setTabId(tab.id);
        try {
          const data = await request<PageInfo>('page-view-info', { tabId: tab.id });
          setInfo(data);
          setSourceScope(data.sourceScope);
        } catch (e) {
          setMessage((e as Error).message);
        }
      }
    });
  }, []);
  const open = (page: string) => chrome.tabs.create({ url: chrome.runtime.getURL(`${page}.html`) });
  async function togglePage() {
    if (!tabId || !info) return;
    setBusy(true);
    setMessage('');
    try {
      await request('page-view-set', { tabId, enabled: !info.enabled, sourceScope });
      const updated = await request<PageInfo>('page-view-info', { tabId });
      setInfo(updated);
      setMessage(
        updated.enabled
          ? 'Original words will appear automatically in this conversation.'
          : 'Protected placeholders are visible again.',
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="popup">
      <div className="section-heading">
        <a className="logo" href="#">
          <Shield />
          Pribruhty
        </a>
        <span className="local-badge">
          <i /> Local
        </span>
      </div>
      <h1>
        Keep the idea.
        <br />
        Protect the details.
      </h1>
      <p>Use AI freely. Keep your secrets private.</p>
      <div className="site-status">
        <span className="status-dot" />
        {site}
      </div>
      <button className="full-width" onClick={() => open('composer')}>
        Open Secure Composer <span>↗</span>
      </button>
      <div className="popup-tools">
        <button onClick={() => open('documents')}>
          <span>▤</span>
          <strong>Documents</strong>
          <small>Replace or encrypt</small>
        </button>
        <button onClick={() => open('wordbank')}>
          <span>Aa</span>
          <strong>Word bank</strong>
          <small>Your local dictionary</small>
        </button>
      </div>
      {info && (
        <section className="page-view-card">
          <h2>Original words on this page</h2>
          <p>
            Like page translation: show Alice wherever her saved placeholder appears, including in
            new replies.
          </p>
          {info.locked ? (
            <p className="notice">Unlock your word bank first.</p>
          ) : info.scopes.length ? (
            <label>
              Word bank for this conversation
              <select
                aria-label="Word bank for this conversation"
                value={sourceScope}
                disabled={info.enabled || busy}
                onChange={(e) => setSourceScope(e.target.value)}
              >
                <option value="">Choose the matching workspace</option>
                {info.scopes.map((scope) => (
                  <option value={scope} key={scope}>
                    {scopeLabel(scope)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted">
              Protect a draft first to save its mappings. Old placeholders cannot be restored
              without their original word bank.
            </p>
          )}
          <p className="page-view-warning">
            When enabled, this website can read restored names too. Use the private reader below to
            keep them outside the page.
          </p>
          <button
            className="full-width"
            aria-pressed={info.enabled}
            disabled={busy || info.locked || (!info.enabled && !sourceScope)}
            onClick={togglePage}
          >
            {info.enabled ? 'Show placeholders on this page' : 'Show original words on this page'}
          </button>
          <p className="muted">
            Your editable draft stays protected. This mode changes rendered messages.
          </p>
        </section>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <button
        className="secondary full-width"
        onClick={() =>
          chrome.windows.getCurrent().then((w) => {
            if (w.id) chrome.sidePanel.open({ windowId: w.id });
          })
        }
      >
        Open private reader beside chat
      </button>
      <div className="popup-footer">
        <button className="text-button" onClick={() => open('settings')}>
          Settings
        </button>
        <span>Review before sharing</span>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
