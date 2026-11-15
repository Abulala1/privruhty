import { useEffect, useState } from 'react';
import { defaultPreferences, preferences, type Preferences } from './voiceguard';
import { voiceguardCSS } from './voiceguardStyle';
export function VoiceGuardSettings() {
  const [value, setValue] = useState(defaultPreferences),
    [status, setStatus] = useState(''),
    [permission, setPermission] = useState('Not requested');
  useEffect(() => {
    void chrome.storage.local.get('voiceguard').then((x) => setValue(preferences(x.voiceguard)));
    void navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((x) => setPermission(x.state))
      .catch(() => setPermission('Check browser site permissions'));
  }, []);
  function update(patch: Partial<Preferences>) {
    const next = preferences({ ...value, ...patch });
    setValue(next);
    void chrome.storage.local
      .set({ voiceguard: next })
      .then(() => setStatus('VoiceGuard preferences saved locally.'));
  }
  return (
    <section className="card voiceguard" aria-label="VoiceGuard settings">
      <style>{voiceguardCSS}</style>
      <h2>VoiceGuard accessibility</h2>
      <p>
        Voice commands use on-device English recognition only. No audio or transcripts are uploaded.
        Start listening explicitly from a review.
      </p>
      {(
        [
          ['enabled', 'Enable VoiceGuard'],
          ['easy', 'Enable Easy Understand Mode'],
          ['spoken', 'Enable spoken explanations'],
          ['gemini', 'Enable optional Gemini explanations'],
          ['fallback', 'Enable local fallback explanations'],
          ['contrast', 'High contrast'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={value[key]}
            onChange={(e) => update({ [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <label>
        Speech speed
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={value.speed}
          onChange={(e) => update({ speed: Number(e.target.value) })}
        />
      </label>
      <label>
        Preferred explanation level
        <select
          value={value.level}
          onChange={(e) => update({ level: e.target.value as Preferences['level'] })}
        >
          <option value="SIMPLE">Simple</option>
          <option value="DETAILED">Detailed</option>
          <option value="LEARN_MORE">Learn more</option>
        </select>
      </label>
      <label>
        Review font size
        <select
          value={value.fontSize}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        >
          <option value={16}>16 px</option>
          <option value={18}>18 px</option>
          <option value={22}>22 px</option>
          <option value={28}>28 px</option>
        </select>
      </label>
      <p>
        Microphone permission: {permission}. No microphone request is made by this settings page.
      </p>
      <p>
        Keyboard help: Tab moves through controls. Enter activates a button. Alt + Right / Left
        changes the item. Alt + Enter approves. Escape cancels.
      </p>
      <p className="warning">
        Gemini is optional. Each review asks for consent before sending only predefined category
        metadata. The API key is configured on your local backend, never here.
      </p>
      <p role="status">{status}</p>
    </section>
  );
}
