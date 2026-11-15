import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { Shell } from './ui';
import { VoiceGuardSettings } from './VoiceGuardSettings';
import { AttachmentSettings } from './AttachmentSettings';
import { CloudSettings } from './CloudSettings';

function App() {
  const [token, setToken] = useState(''),
    [custom, setCustom] = useState(''),
    [saved, setSaved] = useState(''),
    [connection, setConnection] = useState('Not checked');
  useEffect(() => {
    chrome.storage.local.get(['token', 'custom']).then((x) => {
      setToken(x.token || '');
      setCustom(x.custom || '');
    });
  }, []);
  async function save() {
    await chrome.storage.local.set({ token: token.trim(), custom });
    setSaved('Saved locally.');
    setConnection('Not checked');
  }
  async function test() {
    setConnection('Checking…');
    try {
      const response = await fetch('http://127.0.0.1:8765/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pribruhty-token': token.trim() },
        body: JSON.stringify({ text: 'alice@example.com' }),
      });
      setConnection(
        response.ok
          ? 'Connected. Name detection is available when the spaCy model is installed.'
          : response.status === 401
            ? 'Token rejected. Copy it again from the token file.'
            : `Backend returned ${response.status}.`,
      );
    } catch {
      setConnection(
        'Backend unavailable. Start uvicorn in a separate PowerShell window and leave it running.',
      );
    }
  }
  return (
    <Shell
      page="settings"
      title="Make privacy feel effortless."
      description="Connect your local detector and decide which words need extra care."
    >
      <div className="settings-grid">
        <div className="card">
          <span className="step-tag">LOCAL DETECTION</span>
          <h2>Connect your privacy engine</h2>
          <p className="muted">
            Start the Python service, then copy the token from{' '}
            <code>%USERPROFILE%\.pribruhty-token</code>.
          </p>
          <label>
            Local service token
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <div className="row">
            <button onClick={save}>Save settings</button>
            <button className="secondary" onClick={test}>
              Test connection
            </button>
          </div>
          <p className="inline-fact" role="status">
            {saved} {connection}
          </p>
          <label>
            Always protect these terms
            <textarea
              placeholder="One term per line"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
          <p className="muted">
            For names with a specific PERSON or COMPANY category, add them in your word bank
            instead.
          </p>
          <button onClick={save}>Save protected terms</button>
        </div>
        <div>
          <div className="card">
            <span className="step-tag">PRIVATE BY DESIGN</span>
            <h2>Your local word bank</h2>
            <p className="muted">
              Save original-to-placeholder mappings with your own passphrase. The bank uses AES-GCM
              encryption and expires after eight hours. Credentials are never restored.
            </p>
            <a className="button secondary" href="wordbank.html">
              Manage word bank
            </a>
          </div>
          <div className="card">
            <h2>Know the limits</h2>
            <p className="muted">
              A website may see text typed in its own editor before a scan. Use Secure Composer for
              private input. Detection can miss sensitive context, and numerical replacements can
              change calculations.
            </p>
            <button
              className="text-button danger"
              onClick={() =>
                chrome.storage.local.remove(['token', 'custom']).then(() => {
                  setToken('');
                  setCustom('');
                  setSaved('Detector settings deleted. Your word bank is managed separately.');
                  setConnection('Not checked');
                })
              }
            >
              Reset detector settings
            </button>
          </div>
        </div>
      </div>
      <CloudSettings />
      <AttachmentSettings />
      <VoiceGuardSettings />
    </Shell>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
