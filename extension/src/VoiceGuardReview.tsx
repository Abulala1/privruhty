import { useEffect, useRef, useState } from 'react';
import { apply, type Scan } from './core';
import { contentRuntime } from './contentRuntime';
import { PrivateSpeech, type VoiceState } from './speech';
import { voiceguardCSS } from './voiceguardStyle';
import {
  defaultPreferences,
  preferences,
  parseCommand,
  metadata,
  localExplanation,
  validateExplanation,
  ReviewHistory,
  type Preferences,
  type Intent,
  type Explanation,
  type Command,
} from './voiceguard';

type Props = {
  text: string;
  result: Scan;
  accepted: boolean[];
  onChange: (values: boolean[]) => void;
  onApproved: (approved: boolean) => void;
  onCancel: () => void;
  onScan: () => void;
};
export function VoiceGuard(props: Props) {
  const [prefs, setPrefs] = useState(defaultPreferences),
    [index, setIndex] = useState(0),
    [voiceState, setVoiceState] = useState<VoiceState>('Idle'),
    [message, setMessage] = useState(
      'Review your private details. Approval never sends a message.',
    ),
    [explanation, setExplanation] = useState<Explanation | null>(null),
    [source, setSource] = useState('Local explanation'),
    [consent, setConsent] = useState(false),
    [commandText, setCommandText] = useState(''),
    [working, setWorking] = useState(false),
    [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const history = useRef(new ReviewHistory()),
    heading = useRef<HTMLHeadingElement>(null),
    speech = useRef<PrivateSpeech | null>(null),
    dispatchRef = useRef<(command: Command) => Promise<void>>(async () => {}),
    alive = useRef(true),
    explainVersion = useRef(0);
  const current = props.result.spans[index];
  const snapshot = () => ({ accepted: [...props.accepted], index });
  const protectedText = apply(
    props.text,
    props.result.spans.map((s, i) => ({
      ...s,
      replacement:
        s.strategy === 'BLOCK' || props.accepted[i]
          ? s.replacement
          : props.text.slice(s.start, s.end),
    })),
  );
  useEffect(() => {
    alive.current = true;
    speech.current = new PrivateSpeech(
      (state, note) => {
        if (!alive.current) return;
        setVoiceState(state);
        if (note) setMessage(note);
      },
      async (text) => {
        const command = parseCommand(text);
        if (command) await dispatchRef.current(command);
        else setMessage('Command not recognized. Choose a listed command or a learning topic.');
      },
    );
    const load = () =>
      void contentRuntime.send({ kind: 'voiceguard-preferences' }).then((value) => {
        if (alive.current) {
          if (!value || value.error) {
            setMessage('Voice settings unavailable. Refresh the tab to reconnect Privruhty.');
            return;
          }
          setPrefs(preferences(value));
          setPreferencesLoaded(true);
        }
      });
    load();
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.voiceguard) load();
    };
    chrome.storage.onChanged.addListener(changed);
    const hidden = () => {
      if (document.hidden) speech.current?.stop();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      explainVersion.current++;
      speech.current?.destroy();
      chrome.storage.onChanged.removeListener(changed);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    history.current = new ReviewHistory();
    setIndex(0);
    setExplanation(null);
    setConsent(false);
    props.onApproved(false);
  }, [props.text, props.result]);
  useEffect(() => {
    if (preferencesLoaded && prefs.enabled && !document.hidden) void speech.current?.start();
    else speech.current?.stop();
    return () => speech.current?.stop();
  }, [prefs.enabled, preferencesLoaded]);
  useEffect(() => {
    if (current) {
      setExplanation(
        localExplanation(metadata(current, props.result.task, prefs.level, 'EXPLAIN_RISK')),
      );
      setSource('Local explanation');
    } else setExplanation(null);
  }, [index, current, prefs.level]);
  function tell(text: string, readAloud = false) {
    setMessage(text);
    if (prefs.spoken || readAloud) speech.current?.speak(text, prefs.speed);
  }
  function save(next: Preferences) {
    setPrefs(next);
    void contentRuntime.send({ kind: 'voiceguard-preferences', value: next });
  }
  function change(values: boolean[], nextIndex = index) {
    history.current.record(snapshot());
    props.onChange(values);
    setIndex(nextIndex);
    props.onApproved(false);
  }
  async function explain(intent: Intent = 'EXPLAIN_RISK', at = index) {
    const span = props.result.spans[at];
    if (!span) {
      tell('No current finding. Scan your message first.');
      return;
    }
    const m = metadata(
        span,
        props.result.task,
        intent === 'SIMPLIFY' ? 'SIMPLE' : prefs.level,
        intent,
      ),
      local = localExplanation(m),
      version = ++explainVersion.current;
    setIndex(at);
    setWorking(true);
    try {
      let answer = local,
        origin = 'Local explanation';
      if (prefs.gemini && consent) {
        const response = await contentRuntime.send({
          kind: 'explain-risk',
          metadata: m,
          consent: true,
        });
        if (response?.source === 'gemini' && validateExplanation(response.explanation)) {
          answer = response.explanation;
          origin = 'Gemini explanation; local policy still applies';
        } else if (!prefs.fallback) {
          tell('Gemini unavailable. Enable local fallback or try again.');
          return;
        } else origin = 'Local fallback: Gemini unavailable';
      }
      if (!alive.current || version !== explainVersion.current) return;
      setExplanation(answer);
      setSource(origin);
      tell(answer.simple_explanation + (prefs.level === 'LEARN_MORE' ? ' ' + answer.reason : ''));
    } finally {
      if (alive.current && version === explainVersion.current) setWorking(false);
    }
  }
  async function dispatch(command: Command) {
    const at = command.index ?? index,
      span = props.result.spans[at];
    if (command.action !== 'explain') {
      explainVersion.current++;
      setWorking(false);
    }
    switch (command.action) {
      case 'scan':
        props.onApproved(false);
        props.onScan();
        tell('Scanning your message locally.');
        break;
      case 'warnings':
        tell(
          `I found ${props.result.spans.length} private details. ${props.result.spans.map((s) => s.type.toLowerCase().replaceAll('_', ' ')).join(', ')}. ${props.result.warnings.join(' ')}`,
          true,
        );
        break;
      case 'explain':
        if (at >= 0 && at < props.result.spans.length) await explain(command.intent, at);
        else tell('That item is not available.');
        break;
      case 'replace':
      case 'keep': {
        if (!span) {
          tell('No current item.');
          break;
        }
        if (command.action === 'keep' && span.strategy === 'BLOCK') {
          tell('Credentials stay blocked. They cannot be kept.');
          break;
        }
        if (span.strategy === 'MANUAL_REVIEW') {
          tell('This value needs manual review. Changing it may make the answer incorrect.');
          break;
        }
        const values = [...props.accepted];
        values[at] = command.action === 'replace';
        change(values, at);
        tell(
          command.action === 'replace'
            ? `Replacement selected: ${span.replacement}.`
            : 'Original kept in your private draft.',
        );
        break;
      }
      case 'next':
      case 'previous': {
        const next = Math.max(
          0,
          Math.min(props.result.spans.length - 1, index + (command.action === 'next' ? 1 : -1)),
        );
        setIndex(next);
        heading.current?.focus();
        tell(
          props.result.spans.length
            ? `Item ${next + 1} of ${props.result.spans.length}: ${props.result.spans[next].type.toLowerCase().replaceAll('_', ' ')}.`
            : 'No private details detected.',
        );
        break;
      }
      case 'names':
        change(props.accepted.map((v, i) => (props.result.spans[i].type === 'PERSON' ? true : v)));
        tell('Detected names will use placeholders.');
        break;
      case 'undo':
      case 'redo': {
        const state =
          command.action === 'undo'
            ? history.current.undo(snapshot())
            : history.current.redo(snapshot());
        if (state) {
          props.onChange(state.accepted);
          setIndex(state.index);
          props.onApproved(false);
          tell(
            command.action === 'undo'
              ? 'Last change undone in your private draft.'
              : 'Last change redone.',
          );
        } else tell('No change to ' + command.action + '.');
        break;
      }
      case 'repeat':
        tell(explanation?.simple_explanation || message, true);
        break;
      case 'read':
        tell(protectedText || 'Your message is empty.', true);
        break;
      case 'approve':
        if (props.result.safe_to_submit) {
          speech.current?.stop();
          props.onApproved(true);
          tell(
            'Draft approved. Nothing was sent. Use the separate copy or insert control when ready.',
          );
        } else tell('Approval blocked. Review the warnings and exact values first.');
        break;
      case 'cancel':
        speech.current?.stop();
        props.onApproved(false);
        props.onCancel();
        break;
      case 'stop':
        speech.current?.stop();
        setMessage('Listening stopped.');
        break;
    }
  }
  dispatchRef.current = dispatch;
  if (!prefs.enabled)
    return (
      <section className="card">
        <h2>VoiceGuard is off</h2>
        <p>You can review the protected preview and advanced findings without voice controls.</p>
        <button onClick={() => save({ ...prefs, enabled: true })}>Enable VoiceGuard</button>
        <button disabled={!props.result.safe_to_submit} onClick={() => props.onApproved(true)}>
          Approve Draft
        </button>
        <button className="secondary" onClick={props.onCancel}>
          Cancel
        </button>
      </section>
    );
  return (
    <section
      className={`card voiceguard ${prefs.contrast ? 'vg-contrast' : ''}`}
      style={{ fontSize: prefs.fontSize }}
      aria-label="VoiceGuard accessible privacy review"
      onKeyDown={(event) => {
        const action = event.altKey
          ? ({ ArrowRight: 'next', ArrowLeft: 'previous', Enter: 'approve' } as const)[
              event.key as 'ArrowRight'
            ]
          : event.key === 'Escape'
            ? 'cancel'
            : undefined;
        if (action) {
          event.preventDefault();
          void dispatch({ action });
        }
      }}
    >
      <style>{voiceguardCSS}</style>
      <div className="section-heading">
        <h2>VoiceGuard</h2>
        <div className="row">
          <button
            type="button"
            aria-label={
              ['Listening', 'Processing', 'Speaking'].includes(voiceState)
                ? 'Stop speech mode'
                : 'Start speech mode'
            }
            aria-pressed={['Listening', 'Processing', 'Speaking'].includes(voiceState)}
            title="Toggle private speech mode"
            onClick={() =>
              ['Listening', 'Processing', 'Speaking'].includes(voiceState)
                ? speech.current?.stop()
                : void speech.current?.start()
            }
          >
            <span aria-hidden="true">🎙</span>
          </button>
          <span className="pill">{voiceState}</span>
        </div>
      </div>
      <p className="muted">
        Private commands. One decision at a time. Nothing is sent when you approve.
      </p>
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={prefs.easy}
            onChange={(e) => save({ ...prefs, easy: e.target.checked })}
          />{' '}
          Easy Understand Mode
        </label>
        <label>
          Explanation level
          <select
            value={prefs.level}
            onChange={(e) => save({ ...prefs, level: e.target.value as Preferences['level'] })}
          >
            <option value="SIMPLE">Simple</option>
            <option value="DETAILED">Detailed</option>
            <option value="LEARN_MORE">Learn more</option>
          </select>
        </label>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="notice">
        {voiceState}. {message}
      </p>
      <progress
        max={Math.max(1, props.result.spans.length)}
        value={props.result.spans.length ? index + 1 : 0}
        aria-label="Review progress"
      />
      <h3 tabIndex={-1} ref={heading}>
        {current
          ? `Item ${index + 1} of ${props.result.spans.length}: ${current.type.replaceAll('_', ' ')}`
          : 'No private details detected'}
      </h3>
      {current && (
        <>
          <dl>
            <dt>Current private detail</dt>
            <dd className="vg-value">{props.text.slice(current.start, current.end)}</dd>
            <dt>Suggested replacement</dt>
            <dd>
              <code>{current.replacement}</code>
            </dd>
            <dt>Your choice</dt>
            <dd>
              {current.strategy === 'BLOCK'
                ? 'Secret must be removed'
                : props.accepted[index]
                  ? 'Use replacement'
                  : 'Keep original'}
            </dd>
          </dl>
          {explanation && (
            <div className="vg-explanation">
              <h4>{explanation.title}</h4>
              <p>{explanation.simple_explanation}</p>
              {!prefs.easy && (
                <p>
                  <strong>Risk: </strong>
                  {explanation.risk}
                </p>
              )}
              <p>
                <strong>Local recommendation: </strong>
                {
                  localExplanation(
                    metadata(current, props.result.task, prefs.level, 'EXPLAIN_RISK'),
                  ).recommended_action
                }
              </p>
              {(!prefs.easy || prefs.level === 'LEARN_MORE') && <p>{explanation.reason}</p>}
              <p>{explanation.limitation}</p>
              <small>{source}</small>
            </div>
          )}
          <div className="row">
            <button disabled={working} onClick={() => void explain()}>
              Explain
            </button>
            <button
              onClick={() => void dispatch({ action: 'replace' })}
              disabled={current.strategy === 'MANUAL_REVIEW'}
            >
              Replace
            </button>
            <button
              className="secondary"
              disabled={current.strategy === 'BLOCK'}
              onClick={() => void dispatch({ action: 'keep' })}
            >
              Keep
            </button>
          </div>
          <label>
            Learning topic
            <select
              defaultValue="EXPLAIN_RISK"
              onChange={(e) => void explain(e.target.value as Intent)}
            >
              <option value="EXPLAIN_RISK">Why may this be private?</option>
              <option value="EXPLAIN_REPLACEMENT">Why use a replacement?</option>
              <option value="EXPLAIN_PHISHING">What is phishing?</option>
              <option value="EXPLAIN_CORRECTNESS">Will the answer change?</option>
              <option value="SIMPLIFY">Explain more simply</option>
              <option value="GIVE_EXAMPLE">Give an example</option>
            </select>
          </label>
        </>
      )}
      {prefs.gemini && (
        <label className="warning">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{' '}
          Allow Explain to send only the data category, task, strategy, explanation level, and topic
          to Google Gemini. No original text or voice transcript is sent. Google processes this
          metadata under its API terms. Uncheck to use local explanations.
        </label>
      )}
      <div className="row vg-actions">
        {[
          ['previous', 'Previous'],
          ['next', 'Next'],
          ['undo', 'Undo'],
          ['redo', 'Redo'],
          ['repeat', 'Repeat'],
          ['approve', 'Approve Draft'],
          ['cancel', 'Cancel'],
        ].map(([action, label]) => (
          <button
            className="secondary"
            key={action}
            onClick={() => void dispatch({ action: action as Command['action'] })}
          >
            {label}
          </button>
        ))}
      </div>
      <details>
        <summary>More review actions</summary>
        <div className="row">
          {[
            ['names', 'Replace all names'],
            ['warnings', 'Read my warnings'],
            ['read', 'Read the message'],
            ['scan', 'Scan my message'],
          ].map(([action, label]) => (
            <button
              className="secondary"
              key={action}
              onClick={() => void dispatch({ action: action as Command['action'] })}
            >
              {label}
            </button>
          ))}
        </div>
      </details>
      <details open>
        <summary>
          <span aria-hidden="true">🎙 </span>Voice and keyboard controls
        </summary>
        <p>
          Speech mode starts when this review opens, if supported and permitted. Say “change” to
          select the current replacement or “next” to move to the next finding. It runs only in this
          visible review for up to five minutes. Stop at any time. Local English recognition and an
          installed language pack are required. Chrome may ask for microphone permission.
        </p>
        <div className="row">
          <button onClick={() => void speech.current?.start()}>
            <span aria-hidden="true">🎙 </span>Start private voice
          </button>
          <button onClick={() => speech.current?.stop()}>Stop listening</button>
          <button className="secondary" onClick={() => void speech.current?.install()}>
            Install local English pack
          </button>
          <button className="secondary" onClick={() => speech.current?.stopSpeaking()}>
            Stop speech
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={prefs.spoken}
            onChange={(e) => save({ ...prefs, spoken: e.target.checked })}
          />{' '}
          Speak explanations using a local voice
        </label>
        <label>
          Speech speed
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={prefs.speed}
            onChange={(e) => save({ ...prefs, speed: Number(e.target.value) })}
          />
        </label>
        <p>
          Say: change, scan my message, read my warnings, explain this, replace it, keep it, next,
          previous, replace all names, undo, redo, repeat, read the message, approve, cancel, stop.
        </p>
        <p>
          Keyboard: Tab and Enter operate all controls. Alt + Right / Left changes the item. Alt +
          Enter approves. Escape cancels.
        </p>
        <label>
          Type an allowed command
          <input
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const command = parseCommand(commandText);
                if (command) void dispatch(command);
                else tell('Command not recognized. Use one of the listed commands.');
                setCommandText('');
              }
            }}
          />
        </label>
        <button
          onClick={() => {
            const command = parseCommand(commandText);
            if (command) void dispatch(command);
            else tell('Command not recognized.');
            setCommandText('');
          }}
        >
          Run command
        </button>
      </details>
    </section>
  );
}
