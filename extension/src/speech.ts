export type VoiceState =
  | 'Idle'
  | 'Listening'
  | 'Processing'
  | 'Speaking'
  | 'Error'
  | 'Microphone permission denied'
  | 'Local recognition unavailable';
export const unavailable =
  'Private voice recognition is unavailable in this browser. You can continue using keyboard controls.';
type Recognition = {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type RecognitionConstructor = {
  new (): Recognition;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[] }) => Promise<boolean>;
};
type SpeechEnvironment = {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
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
  constructor(
    private state: (state: VoiceState, message?: string) => void,
    private command: (text: string) => Promise<void> | void,
    private env: SpeechEnvironment = globalThis as unknown as SpeechEnvironment,
  ) {}
  private ctor() {
    return this.env.SpeechRecognition || this.env.webkitSpeechRecognition;
  }
  async install() {
    const ctor = this.ctor();
    try {
      if (!ctor?.install || !ctor.available || !('processLocally' in new ctor())) throw new Error();
      const ok = await ctor.install({ langs: ['en-US'] });
      this.state(
        ok ? 'Idle' : 'Local recognition unavailable',
        ok ? 'Local language pack installed.' : unavailable,
      );
    } catch {
      this.state('Local recognition unavailable', unavailable);
    }
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
      if (available !== 'available') throw new Error();
      recognition.processLocally = true;
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      this.recognition = recognition;
      this.session = true;
      recognition.onresult = (event) => {
        if (!this.session || this.speaking || this.processing) return;
        const result = event.results[event.resultIndex || 0];
        if (!result?.isFinal) return;
        this.processing = true;
        this.state('Processing');
        // Transcripts live only for dispatch. They are never stored or uploaded.
        void Promise.resolve(this.command(String(result[0]?.transcript || ''))).finally(() => {
          this.processing = false;
          if (this.session && !this.speaking) this.listen();
        });
      };
      recognition.onerror = (event) => {
        if (!this.session) return;
        if (event.error === 'aborted' && (this.speaking || this.processing)) return;
        if (event.error === 'no-speech') {
          this.state('Listening');
          return;
        }
        this.stop();
        this.state(
          event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'Microphone permission denied'
            : 'Error',
          event.error === 'not-allowed'
            ? 'Microphone permission denied. Use keyboard controls.'
            : 'Private recognition stopped. Use keyboard controls.',
        );
      };
      recognition.onend = () => {
        if (this.session && !this.processing && !this.speaking) this.listen();
      };
      this.timer = setTimeout(() => {
        this.stop();
        this.state('Idle', 'Voice session ended after five minutes. Start again when ready.');
      }, 300000);
      this.listen();
    } catch {
      if (version === this.version) this.state('Local recognition unavailable', unavailable);
    }
  }
  private listen() {
    if (!this.session || this.speaking || this.disposed) return;
    try {
      this.recognition?.start();
      this.state('Listening');
    } catch {
      /* Already running; never fall back to a remote recognizer. */
    }
  }
  stop() {
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
