import { speechCommandHints, fastCommandDelay } from './voiceguard';

export type VoiceState =
  | 'Idle'
  | 'Listening'
  | 'Processing'
  | 'Speaking'
  | 'Error'
  | 'Microphone permission denied'
  | 'Language pack required'
  | 'Downloading language pack'
  | 'Local recognition unavailable';
export const unavailable =
  'Private voice recognition is unavailable in this browser. You can continue using keyboard controls.';
type Recognition = {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  phrases?: { phrase: string; boost: number }[];
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type RecognitionConstructor = {
  new (): Recognition;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};
type SpeechEnvironment = {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  SpeechRecognitionPhrase?: new (
    phrase: string,
    boost: number,
  ) => { phrase: string; boost: number };
};
export class PrivateSpeech {
  private recognition: Recognition | null = null;
  private session = false;
  private processing = false;
  private speaking = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;
  private last = '';
  private disposed = false;
  private hintsSupported = true;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private pendingText = '';
  private handledInterim = false;
  private recognitionEnded = false;
  private endingEarly = false;
  constructor(
    private state: (state: VoiceState, message?: string) => void,
    private command: (text: string) => Promise<void> | void,
    private env: SpeechEnvironment = globalThis as unknown as SpeechEnvironment,
  ) {}
  private ctor() {
    return this.env.SpeechRecognition || this.env.webkitSpeechRecognition;
  }
  async install() {
    this.stop();
    const version = this.version;
    const ctor = this.ctor();
    try {
      if (!ctor?.install || !ctor.available || !('processLocally' in new ctor())) throw new Error();
      this.state(
        'Downloading language pack',
        'Chrome is setting up local English recognition. Keep this review open.',
      );
      const ok = await ctor.install({ langs: ['en-US'], processLocally: true });
      if (version !== this.version || this.disposed) return;
      if (ok) await this.start();
      else
        this.state(
          'Language pack required',
          'Chrome could not install the English pack. Check your internet connection and try Install local English pack again.',
        );
    } catch (error) {
      if (version !== this.version || this.disposed) return;
      this.state('Local recognition unavailable', this.failure(error));
    }
  }
  private failure(error: unknown) {
    if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name))
      return 'Chrome blocked local speech setup on this page. Click Install local English pack, or try speech in Privruhty Secure Composer. Check browser microphone permissions.';
    return unavailable;
  }
  async start() {
    this.stop();
    const version = this.version,
      ctor = this.ctor();
    try {
      if (!ctor?.available) throw new Error();
      const recognition = new ctor();
      if (!('processLocally' in recognition)) throw new Error();
      const available = await ctor.available({ langs: ['en-US'], processLocally: true });
      if (version !== this.version || this.disposed) return;
      if (available === 'downloadable') {
        this.state(
          'Language pack required',
          'Chrome supports local speech, but English needs setup for this page. Click Install local English pack below; listening will start after installation.',
        );
        return;
      }
      if (available === 'downloading') {
        this.state(
          'Downloading language pack',
          'Chrome is downloading the English speech pack. Wait for it to finish, then choose Start private voice.',
        );
        return;
      }
      if (available !== 'available') throw new Error();
      recognition.processLocally = true;
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      if (this.hintsSupported && this.env.SpeechRecognitionPhrase && 'phrases' in recognition) {
        try {
          recognition.phrases = speechCommandHints.map(
            (phrase) =>
              new this.env.SpeechRecognitionPhrase!(
                phrase,
                ['change', 'apply', 'replace'].includes(phrase) ? 5 : 3,
              ),
          );
        } catch {
          this.hintsSupported = false;
        }
      }
      this.recognition = recognition;
      this.session = true;
      recognition.onresult = (event) => {
        if (!this.session || this.speaking || this.processing) return;
        const result = event.results[event.resultIndex || 0];
        if (!result || this.handledInterim) return;
        const text = String(result[0]?.transcript || '');
        if (result.isFinal) {
          this.clearPending();
          this.dispatchText(text, true);
          return;
        }
        const delay = fastCommandDelay(text);
        if (delay === null) {
          this.clearPending();
          return;
        }
        if (this.pendingText === text) return;
        this.clearPending();
        this.pendingText = text;
        this.pending = setTimeout(() => {
          this.clearPending();
          if (!this.session || this.processing || this.speaking || this.handledInterim) return;
          this.handledInterim = true;
          this.dispatchText(text, false);
        }, delay);
      };
      recognition.onerror = (event) => {
        if (!this.session) return;
        this.clearPending();
        if (event.error === 'phrases-not-supported' && this.hintsSupported) {
          this.hintsSupported = false;
          recognition.phrases = [];
          this.state(
            'Listening',
            'Command hints are unavailable; listening continues without them.',
          );
          return;
        }
        if (event.error === 'aborted' && (this.speaking || this.processing || this.endingEarly))
          return;
        if (event.error === 'no-speech') {
          this.state('Listening');
          return;
        }
        this.stop();
        this.state(
          event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'Microphone permission denied'
            : 'Error',
          ['not-allowed', 'service-not-allowed'].includes(event.error)
            ? 'Microphone permission denied. Allow microphone access in Chrome site settings and Windows Settings > Privacy & security > Microphone, then click Start private voice.'
            : event.error === 'audio-capture'
              ? 'No usable microphone found. Connect a microphone and check Chrome and Windows microphone settings.'
              : event.error === 'language-not-supported'
                ? 'The local English speech pack is not ready. Click Install local English pack to set it up.'
                : `Local recognition stopped (${event.error || 'unknown error'}). Click Start private voice to retry.`,
        );
      };
      recognition.onend = () => {
        this.clearPending();
        this.recognitionEnded = true;
        this.endingEarly = false;
        this.handledInterim = false;
        if (this.session && !this.processing && !this.speaking) this.listen();
      };
      this.timer = setTimeout(() => {
        this.stop();
        this.state('Idle', 'Voice session ended after five minutes. Start again when ready.');
      }, 300000);
      this.listen();
    } catch (error) {
      if (version === this.version)
        this.state('Local recognition unavailable', this.failure(error));
    }
  }
  private clearPending() {
    clearTimeout(this.pending);
    this.pending = undefined;
    this.pendingText = '';
  }
  private dispatchText(text: string, final: boolean) {
    const version = this.version;
    this.processing = true;
    this.state('Processing');
    void Promise.resolve()
      .then(() => {
        if (version !== this.version || !this.session || this.disposed) return;
        return this.command(text);
      })
      .catch(() => {
        if (version === this.version)
          this.state(
            'Error',
            'The command could not be applied. Try again or use the review buttons.',
          );
      })
      .finally(() => {
        if (version !== this.version) return;
        this.processing = false;
        if (this.session && !this.speaking) {
          if (final || this.recognitionEnded) this.listen();
          else {
            this.endingEarly = true;
            try {
              this.recognition?.abort();
            } catch {
              /* Wait for the normal end event if abort is refused. */
            }
            this.state('Listening');
          }
        }
      });
  }
  private listen() {
    if (!this.session || this.speaking || this.disposed) return;
    try {
      this.recognition?.start();
      this.recognitionEnded = false;
      this.state('Listening');
    } catch (error) {
      // A running recognizer may reject another start; other failures must be visible.
      if (error instanceof DOMException && error.name === 'InvalidStateError') return;
      this.stop();
      this.state(
        'Error',
        'Chrome could not start local listening. Allow microphone access, then choose Start private voice.',
      );
    }
  }
  stop() {
    this.clearPending();
    this.handledInterim = false;
    this.endingEarly = false;
    this.processing = false;
    this.version++;
    this.session = false;
    clearTimeout(this.timer);
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.abort();
      this.recognition = null;
    }
    this.stopSpeaking(false);
    this.state('Idle');
  }
  stopSpeaking(resume = true) {
    this.env.speechSynthesis?.cancel();
    this.speaking = false;
    if (resume && this.session && !this.processing) this.listen();
  }
  speak(text: string, rate = 1) {
    this.last = text;
    const synth = this.env.speechSynthesis,
      Utterance = this.env.SpeechSynthesisUtterance;
    const voice = synth?.getVoices().find((v) => v.localService && v.lang.startsWith('en'));
    if (!synth || !Utterance || !voice) {
      this.state(
        this.session ? 'Listening' : 'Idle',
        'Local speech output unavailable. The explanation is displayed as text.',
      );
      return;
    }
    this.speaking = true;
    this.recognition?.abort();
    synth.cancel();
    const utterance = new Utterance(text);
    utterance.voice = voice;
    utterance.rate = Math.max(0.5, Math.min(2, rate));
    utterance.onend = () => {
      this.speaking = false;
      this.state('Idle');
      if (this.session && !this.processing) this.listen();
    };
    utterance.onerror = () => {
      this.speaking = false;
      this.state('Error', 'Local speech output failed.');
    };
    this.state('Speaking');
    synth.speak(utterance);
  }
  repeat(rate = 1) {
    if (this.last) this.speak(this.last, rate);
  }
  destroy() {
    this.disposed = true;
    this.stop();
  }
}
