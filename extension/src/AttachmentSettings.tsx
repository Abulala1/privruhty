import { useEffect, useState } from 'react';
import {
  attachmentPreferences,
  defaultAttachmentPreferences,
  type AttachmentPreferences,
} from './attachmentPolicy';

export function AttachmentSettings() {
  const [value, setValue] = useState(defaultAttachmentPreferences),
    [status, setStatus] = useState('');
  useEffect(() => {
    void chrome.storage.local
      .get('attachmentProtection')
      .then((data) => setValue(attachmentPreferences(data.attachmentProtection)));
  }, []);
  function update(patch: Partial<AttachmentPreferences>) {
    const next = { ...value, ...patch };
    setValue(next);
    void chrome.storage.local
      .set({ attachmentProtection: next })
      .then(() => setStatus('Attachment settings saved locally.'));
  }
  return (
    <section className="card" aria-label="Attachment protection settings">
      <h2>Protect chat attachments</h2>
      <p>
        Files dropped, picked, or pasted into supported AI chats are held before Privruhty scans
        them locally. TXT and CSV files up to 1 MB each are supported, with up to five files per
        batch.
      </p>
      <label>
        <input
          type="checkbox"
          style={{ width: 20, height: 20, verticalAlign: 'middle', marginRight: 8 }}
          checked={value.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        Enable attachment protection
      </label>
      <label>
        Attachment handling
        <select
          value={value.mode}
          onChange={(event) =>
            update({ mode: event.target.value as AttachmentPreferences['mode'] })
          }
        >
          <option value="auto">Auto-protect and attach checked copies</option>
          <option value="review">Review before attaching checked copies</option>
        </select>
      </label>
      <p className="warning">
        Attaching can upload a file to the website immediately, before you send the chat message.
        Auto-protect authorizes Privruhty to attach checked copies automatically. Detection can miss
        information; connect the local engine for name detection.
      </p>
      <p>
        Original source files stay unchanged. Protected copies use generic filenames. Unsupported
        formats, locked mappings, policy warnings, or failed scans hold the upload. If scripted
        attachment is not accepted, download a checked copy and attach it manually.
      </p>
      {!value.enabled && (
        <p className="warning">
          Protection is off. Original files can reach the website without scanning.
        </p>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
