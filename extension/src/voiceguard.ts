import type { Span } from './core';
export const categories = [
  'PERSON',
  'EMAIL',
  'PHONE',
  'ADDRESS',
  'LOCATION',
  'CREDIT_CARD',
  'GOVERNMENT_ID',
  'PASSWORD',
  'API_KEY',
  'SALARY',
  'FINANCIAL',
  'MEDICAL',
  'COMPANY',
  'PROJECT_SECRET',
  'CUSTOM',
] as const;
export type Category = (typeof categories)[number];
export type Intent =
  | 'EXPLAIN_RISK'
  | 'EXPLAIN_REPLACEMENT'
  | 'EXPLAIN_PHISHING'
  | 'EXPLAIN_CORRECTNESS'
  | 'SIMPLIFY'
  | 'GIVE_EXAMPLE';
export type Command = {
  action:
    | 'scan'
    | 'warnings'
    | 'explain'
    | 'replace'
    | 'keep'
    | 'next'
    | 'previous'
    | 'names'
    | 'undo'
    | 'redo'
    | 'repeat'
    | 'read'
    | 'approve'
    | 'cancel'
    | 'stop';
  intent?: Intent;
  index?: number;
  applyCurrent?: boolean;
};
const commands: Record<string, Command['action']> = {
  'scan my message': 'scan',
  scan: 'scan',
  'read my warnings': 'warnings',
  'replace it': 'replace',
  change: 'replace',
  'change it': 'replace',
  replace: 'replace',
  yes: 'replace',
  'keep it': 'keep',
  next: 'next',
  skip: 'next',
  'skip it': 'next',
  previous: 'previous',
  'replace all names': 'names',
  undo: 'undo',
  redo: 'redo',
  repeat: 'repeat',
  'read the message': 'read',
  approve: 'approve',
  'approve draft': 'approve',
  cancel: 'cancel',
  stop: 'stop',
};
const questions: Record<string, Intent> = {
  'explain this': 'EXPLAIN_RISK',
  'why is this dangerous': 'EXPLAIN_RISK',
  'what can happen if i share it': 'EXPLAIN_RISK',
  'what does phishing mean': 'EXPLAIN_PHISHING',
  'why should i hide my address': 'EXPLAIN_REPLACEMENT',
  'will replacing this change the ai answer': 'EXPLAIN_CORRECTNESS',
  'explain it more simply': 'SIMPLIFY',
  'give an example': 'GIVE_EXAMPLE',
};
export const applyPhrases = [
  'change',
  'change it',
  'change this',
  'apply',
  'apply it',
  'apply change',
  'apply this change',
  'replace',
  'replace this',
  'changed',
  'changed it',
  'applied',
  'apply now',
  'make the change',
];
// Match short replacement utterances, never arbitrary sentences or approval actions.
function nearWord(word: string, target: string): boolean {
  if (word === target) return true;
  if (Math.abs(word.length - target.length) > 1) return false;
  if (word.length === target.length) {
    const differences = [...word].flatMap((letter, i) => (letter === target[i] ? [] : [i]));
    return (
      differences.length === 1 ||
      (differences.length === 2 &&
        differences[1] === differences[0] + 1 &&
        word[differences[0]] === target[differences[1]] &&
        word[differences[1]] === target[differences[0]])
    );
  }
  const longer = word.length > target.length ? word : target,
    shorter = word.length > target.length ? target : word;
  for (let i = 0; i < longer.length; i++)
    if (longer.slice(0, i) + longer.slice(i + 1) === shorter) return true;
  return false;
}
function approximateReplacement(text: string): boolean {
  if (['a ply', 'a play', 'a plie', 're place'].includes(text)) return true;
  const match = /^([a-z]{4,9})(?: (?:it|this|now))?$/.exec(text);
  return (
    !!match &&
    ['change', 'changed', 'apply', 'applied', 'replace', 'replaced'].some((word) =>
      nearWord(match[1], word),
    )
  );
}
export const speechCommandHints = [
  ...applyPhrases,
  'next',
  'next item',
  'keep it',
  'undo',
  'previous',
  'stop',
];
export function parseCommand(value: string): Command | null {
  const text = value
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:(?:please|um|uh) )+/, '')
    .replace(/ please$/, '');
  if (applyPhrases.includes(text)) return { action: 'replace', applyCurrent: true };
  if (text === 'next item' || text === 'go next') return { action: 'next' };
  if (commands[text]) return { action: commands[text] };
  if (approximateReplacement(text)) return { action: 'replace', applyCurrent: true };
  if (questions[text]) return { action: 'explain', intent: questions[text] };
  const numbered = /^explain (?:the )?(first|second|third|fourth|fifth|\d+)(?: one| item)?$/.exec(
    text,
  );
  if (numbered) {
    const n = ['first', 'second', 'third', 'fourth', 'fifth'].indexOf(numbered[1]);
    const index = n >= 0 ? n : Number(numbered[1]) - 1;
    if (index >= 0 && index < 2000) return { action: 'explain', intent: 'EXPLAIN_RISK', index };
  }
  return null;
}
export type Preferences = {
  enabled: boolean;
  easy: boolean;
  spoken: boolean;
  speed: number;
  level: 'SIMPLE' | 'DETAILED' | 'LEARN_MORE';
  gemini: boolean;
  fallback: boolean;
  contrast: boolean;
  fontSize: number;
};
export const defaultPreferences: Preferences = {
  enabled: true,
  easy: true,
  spoken: false,
  speed: 1,
  level: 'SIMPLE',
  gemini: false,
  fallback: true,
  contrast: false,
  fontSize: 18,
};
export function preferences(value: Partial<Preferences> = {}): Preferences {
  return {
    ...defaultPreferences,
    ...value,
    speed: Math.max(0.5, Math.min(2, Number(value.speed) || 1)),
    fontSize: Math.max(16, Math.min(28, Number(value.fontSize) || 18)),
  };
}
export type Metadata = {
  detected_type: Category;
  task_type: 'GENERAL' | 'WRITING' | 'CALCULATION' | 'DATA_ANALYSIS' | 'MEDICAL';
  suggested_strategy: 'PSEUDONYM' | 'BLOCK' | 'MANUAL_REVIEW' | 'KEEP';
  explanation_level: Preferences['level'];
  question_type: Intent;
};
export function metadata(
  span: Span,
  task: string,
  level: Preferences['level'],
  intent: Intent,
): Metadata {
  return {
    detected_type: categories.includes(span.type as Category) ? (span.type as Category) : 'CUSTOM',
    task_type: ['WRITING', 'CALCULATION', 'DATA_ANALYSIS', 'MEDICAL'].includes(task)
      ? (task as Metadata['task_type'])
      : 'GENERAL',
    suggested_strategy: ['BLOCK', 'MANUAL_REVIEW', 'KEEP'].includes(span.strategy)
      ? (span.strategy as Metadata['suggested_strategy'])
      : 'PSEUDONYM',
    explanation_level: level,
    question_type: intent,
  };
}
export type Explanation = {
  title: string;
  simple_explanation: string;
  risk: string;
  recommended_action: 'REPLACE' | 'BLOCK' | 'REVIEW' | 'KEEP';
  reason: string;
  limitation: string;
};
const lessons: Record<Category, [string, string]> = {
  PERSON: [
    'A name can identify someone.',
    'A made-up label lets the AI discuss a person without their real name.',
  ],
  EMAIL: [
    'An email address identifies a contact.',
    'Phishing messages may imitate trusted senders. Check unexpected links and requests.',
  ],
  PHONE: [
    'A phone number can identify or contact someone.',
    'A placeholder keeps the purpose of a message without revealing a contact number.',
  ],
  ADDRESS: [
    'A street address may reveal where someone lives or works.',
    'Use a general area when the exact street is not needed.',
  ],
  LOCATION: [
    'A location can reveal someone’s movements or whereabouts.',
    'An exact location may be necessary for directions. Review the task first.',
  ],
  CREDIT_CARD: [
    'A card number is sensitive payment information.',
    'Use a placeholder for examples. Never share security codes.',
  ],
  GOVERNMENT_ID: [
    'An official identity number can identify someone.',
    'Identity numbers can be misused in impersonation attempts.',
  ],
  PASSWORD: [
    'A password can give access to an account.',
    'Remove credentials. If a real secret was exposed, change or revoke it.',
  ],
  API_KEY: [
    'An API key can authorize access or spending.',
    'Remove credentials. If a real secret was exposed, revoke and replace it.',
  ],
  SALARY: [
    'Pay information is personal financial information.',
    'Replacing an amount changes calculations. Calculate locally or review exact values.',
  ],
  FINANCIAL: [
    'Financial values can reveal private finances.',
    'Replacing numbers can make a calculation incorrect. Review before sharing.',
  ],
  MEDICAL: [
    'Health information can reveal private circumstances.',
    'Removing clinical details can change an answer. Do not rely on AI for medical decisions.',
  ],
  COMPANY: [
    'A company name may reveal a private business relationship.',
    'A general company label may be enough for drafting. Public names are not always sensitive.',
  ],
  PROJECT_SECRET: [
    'Project details may reveal confidential work.',
    'Share only information you are authorized to disclose.',
  ],
  CUSTOM: [
    'This term was marked for privacy review.',
    'Check whether the task needs the exact value.',
  ],
};
export function localExplanation(m: Metadata): Explanation {
  const [simple, lesson] = lessons[m.detected_type];
  const secret =
    ['PASSWORD', 'API_KEY'].includes(m.detected_type) || m.suggested_strategy === 'BLOCK';
  const action = secret
    ? 'BLOCK'
    : m.suggested_strategy === 'MANUAL_REVIEW'
      ? 'REVIEW'
      : m.suggested_strategy === 'KEEP'
        ? 'KEEP'
        : 'REPLACE';
  const explanation =
    m.question_type === 'EXPLAIN_PHISHING'
      ? 'Phishing is a deceptive message that tries to obtain private information or access. Verify the sender using a trusted channel.'
      : m.question_type === 'GIVE_EXAMPLE'
        ? 'For example, replace a synthetic name such as Alex Example with PERSON_1.'
        : m.question_type === 'EXPLAIN_CORRECTNESS'
          ? 'Replacing values can change calculations, directions, or medical context. Review whether the task needs exact details.'
          : simple;
  return {
    title: `Review ${m.detected_type.toLowerCase().replaceAll('_', ' ')}`,
    simple_explanation:
      explanation +
      (m.explanation_level === 'DETAILED'
        ? ' External AI services process information you share under their own policies.'
        : ''),
    risk: simple,
    recommended_action: action,
    reason: lesson,
    limitation: secret
      ? 'Credentials stay blocked and are never restored.'
      : ['FINANCIAL', 'SALARY', 'MEDICAL', 'LOCATION'].includes(m.detected_type)
        ? lesson
        : 'A saved local mapping is needed to restore the exact original later.',
  };
}
export function validateExplanation(value: unknown): value is Explanation {
  if (!value || typeof value !== 'object') return false;
  const x = value as Record<string, unknown>;
  return (
    Object.keys(x).length === 6 &&
    ['title', 'simple_explanation', 'risk', 'reason', 'limitation'].every(
      (k) =>
        typeof x[k] === 'string' && (x[k] as string).length > 0 && (x[k] as string).length <= 1200,
    ) &&
    ['REPLACE', 'BLOCK', 'REVIEW', 'KEEP'].includes(String(x.recommended_action))
  );
}
export type ReviewSnapshot = { accepted: boolean[]; index: number };
export class ReviewHistory {
  private past: ReviewSnapshot[] = [];
  private future: ReviewSnapshot[] = [];
  record(state: ReviewSnapshot) {
    this.past.push(structuredClone(state));
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  undo(state: ReviewSnapshot) {
    const last = this.past.pop();
    if (!last) return null;
    this.future.push(structuredClone(state));
    return last;
  }
  redo(state: ReviewSnapshot) {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(structuredClone(state));
    return next;
  }
}
