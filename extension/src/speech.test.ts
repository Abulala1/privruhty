import { it, expect, vi } from 'vitest';
import { PrivateSpeech } from './speech';
class LocalRecognition {
  static instance: LocalRecognition;
  static available = vi.fn(async () => 'available');
  processLocally = false;
  lang = '';
  continuous = true;
  interimResults = true;
  onresult: any;
  onerror: any;
  onend: any;
  start = vi.fn();
  abort = vi.fn();
  constructor() {
    LocalRecognition.instance = this;
  }
}
it('biases local recognition toward commands and keeps listening if hints are unsupported', async () => {
  class HintedRecognition extends LocalRecognition {
    phrases: { phrase: string; boost: number }[] = [];
  }
  class Phrase {
    constructor(
      public phrase: string,
      public boost: number,
    ) {}
  }
  const speech = new PrivateSpeech(vi.fn(), vi.fn(), {
    SpeechRecognition: HintedRecognition,
    SpeechRecognitionPhrase: Phrase,
  });
  await speech.start();
  const r = LocalRecognition.instance as HintedRecognition;
  expect(r.phrases).toContainEqual({ phrase: 'apply it', boost: 3 });
  r.onerror({ error: 'phrases-not-supported' });
  expect(r.phrases).toEqual([]);
  r.onend();
  expect(r.start.mock.calls.length).toBeGreaterThan(1);
  speech.destroy();
});
it('does not start a recognizer without explicit local capability and an installed pack', async () => {
  const state = vi.fn(),
    speech = new PrivateSpeech(state, vi.fn(), {});
  await speech.start();
  expect(state).toHaveBeenLastCalledWith(
    'Local recognition unavailable',
    expect.stringContaining('keyboard'),
  );
  LocalRecognition.available.mockResolvedValueOnce('downloadable');
  const withPack = new PrivateSpeech(state, vi.fn(), { SpeechRecognition: LocalRecognition });
  await withPack.start();
  expect(LocalRecognition.instance.start).not.toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith(
    'Language pack required',
    expect.stringContaining('Install local English pack'),
  );
  withPack.destroy();
});
it('starts listening after successful local pack setup and does not resume after canceled setup', async () => {
  class Installable extends LocalRecognition {
    // Chrome returns false when processLocally is omitted, even for a supported language.
    static install = vi.fn(
      async (options: { langs: string[]; processLocally: boolean }) =>
        options.processLocally === true,
    );
  }
  const state = vi.fn(),
    speech = new PrivateSpeech(state, vi.fn(), { SpeechRecognition: Installable });
  await speech.install();
  expect(Installable.install).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
  expect(LocalRecognition.instance.start).toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith('Listening');
  speech.destroy();
  let finish!: (ok: boolean) => void;
  Installable.install.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stopped = new PrivateSpeech(state, vi.fn(), { SpeechRecognition: Installable });
  const pending = stopped.install();
  stopped.stop();
  finish(true);
  await pending;
  expect(state).toHaveBeenLastCalledWith('Idle');
  stopped.destroy();
});
it('forces local processing, dispatches final results, handles permission denial, and stops on cancel', async () => {
  const state = vi.fn(),
    command = vi.fn(),
    speech = new PrivateSpeech(state, command, { SpeechRecognition: LocalRecognition });
  await speech.start();
  const r = LocalRecognition.instance;
  expect(r.processLocally).toBe(true);
  expect(r.continuous).toBe(false);
  expect(r.start).toHaveBeenCalled();
  r.onresult({ results: [Object.assign([{ transcript: 'next' }], { isFinal: true })] });
  await Promise.resolve();
  expect(command).toHaveBeenCalledWith('next');
  r.onerror({ error: 'not-allowed' });
  expect(state).toHaveBeenLastCalledWith('Microphone permission denied', expect.any(String));
  expect(r.abort).toHaveBeenCalled();
  expect(r.onresult).toBeNull();
  speech.destroy();
});
it('rejects remote-only synthesis and pauses recognition during local speech output', async () => {
  const synth = {
    getVoices: () => [{ localService: false, lang: 'en-US' }],
    speak: vi.fn(),
    cancel: vi.fn(),
  };
  const state = vi.fn();
  const speech = new PrivateSpeech(state, vi.fn(), { speechSynthesis: synth as any });
  speech.speak('Private');
  expect(synth.speak).not.toHaveBeenCalled();
  speech.destroy();
  let utterance: any;
  class Utterance {
    voice: any;
    rate = 1;
    onend: any;
    onerror: any;
    constructor(public text: string) {
      utterance = this;
    }
  }
  const local = { ...synth, getVoices: () => [{ localService: true, lang: 'en-US' }] };
  const command = vi.fn();
  const live = new PrivateSpeech(state, command, {
    SpeechRecognition: LocalRecognition,
    speechSynthesis: local as any,
    SpeechSynthesisUtterance: Utterance as any,
  });
  await live.start();
  live.speak('Next');
  const r = LocalRecognition.instance;
  r.onresult({ results: [Object.assign([{ transcript: 'replace it' }], { isFinal: true })] });
  expect(command).not.toHaveBeenCalled();
  utterance.onend();
  expect(r.start.mock.calls.length).toBeGreaterThan(1);
  live.stop();
  expect(r.onresult).toBeNull();
  live.destroy();
});
