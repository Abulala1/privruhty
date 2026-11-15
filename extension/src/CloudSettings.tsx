import React, { useEffect, useState } from 'react';
import { cloudOrigin } from './detector';

export function CloudSettings() {
  const [enabled, setEnabled] = useState(false),
    [url, setUrl] = useState(''),
    [token, setToken] = useState(''),
    [consent, setConsent] = useState(false),
    [status, setStatus] = useState('');
  useEffect(() => {
    void chrome.storage.local.get('cloudDetector').then(({ cloudDetector: c }) => {
      if (c) {
        setEnabled(c.enabled === true);
        setUrl(c.url || '');
        setToken(c.token || '');
        setConsent(c.consent === true);
      }
    });
  }, []);
  async function save() {
    try {
      let origin = url;
      if (enabled) {
        origin = cloudOrigin(url);
        if (!consent || !token.trim())
          throw new Error('Confirm cloud scanning and enter your server token.');
        if (!(await chrome.permissions.request({ origins: [origin + '/*'] })))
          throw new Error('Server access was not granted.');
      }
      await chrome.storage.local.set({
        cloudDetector: { enabled, url: origin, token: token.trim(), consent: enabled && consent },
      });
      setStatus(
        enabled
          ? 'Cloud detector saved. New scans use your HTTPS server.'
          : 'Local detection selected.',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save cloud settings.');
    }
  }
  async function test() {
    setStatus('Testing cloud scan...');
    try {
      const origin = cloudOrigin(url);
      if (!consent) throw new Error('Confirm cloud scanning first.');
      if (!(await chrome.permissions.request({ origins: [origin + '/*'] })))
        throw new Error('Server access was not granted.');
      const start = performance.now();
      const response = await fetch(origin + '/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pribruhty-token': token.trim() },
        body: JSON.stringify({ text: 'alice@example.com' }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new Error(
          `Cloud detector returned ${response.status}. Check its token and configuration.`,
        );
      const result = await response.json();
      if (!Array.isArray(result.spans) || !result.spans.some((s: any) => s.type === 'EMAIL'))
        throw new Error('The server did not return a valid email detection.');
      setStatus(
        `Cloud scan succeeded in ${Math.round(performance.now() - start)} ms. Save cloud settings to use it.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Cloud connection failed. Check your HTTPS domain.',
      );
    }
  }
  return (
    <section className="card" aria-label="Vultr cloud detector">
      <span className="step-tag">VULTR CLOUD COMPUTE</span>
      <h2>Run detection on your server</h2>
      <p>
        Use your Vultr backend for scans across your devices. Local detection remains the default.
        Network latency and server size affect speed.
      </p>
      <label>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{' '}
        Use cloud detector
      </label>
      <label>
        Cloud HTTPS URL
        <input
          type="url"
          placeholder="https://privacy.your-domain.com"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setConsent(false);
          }}
        />
      </label>
      <label>
        Cloud service token
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <label>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I
        agree to send original scanned text, attachment text, and custom terms to this server for
        detection.
      </label>
      <p className="muted">
        Word-bank encryption and placeholder restoration stay in the extension. Server credentials
        are stored locally. If cloud detection fails, limited checks run on this device; names may
        be missed.
      </p>
      <div className="row">
        <button onClick={() => void save()}>Save cloud settings</button>
        <button className="secondary" onClick={() => void test()}>
          Test cloud connection
        </button>
      </div>
      <p role="status">{status}</p>
    </section>
  );
}
