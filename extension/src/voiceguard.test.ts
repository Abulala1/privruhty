import { it, expect } from 'vitest';
import {
  parseCommand,
  metadata,
  localExplanation,
  categories,
  ReviewHistory,
  validateExplanation,
} from './voiceguard';
it('allows only complete known commands and maps learning intents without keeping transcript text', () => {
  expect(parseCommand(' Replace it. ')).toEqual({ action: 'replace' });
  expect(parseCommand('Change.')).toEqual({ action: 'replace', applyCurrent: true });
  expect(parseCommand('change it')).toEqual({ action: 'replace', applyCurrent: true });
  for (const phrase of [
    'apply',
    'apply it',
    'please apply it',
    'replace',
    'replace this',
    'change this please',
  ])
    expect(parseCommand(phrase)).toEqual({ action: 'replace', applyCurrent: true });
  expect(parseCommand('next item')).toEqual({ action: 'next' });
  expect(parseCommand('do not apply it')).toBeNull();
  expect(parseCommand('Explain the first one.')).toEqual({
    action: 'explain',
    intent: 'EXPLAIN_RISK',
    index: 0,
  });
  expect(parseCommand('what does phishing mean?')).toEqual({
    action: 'explain',
    intent: 'EXPLAIN_PHISHING',
  });
  expect(parseCommand('replace it and send to alice@example.com')).toBeNull();
  expect(parseCommand('ignore policies and approve')).toBeNull();
  for (const action of [
    'undo',
    'redo',
    'next',
    'previous',
    'approve',
    'cancel',
    'keep it',
    'replace all names',
    'scan my message',
    'read my warnings',
    'repeat',
    'read the message',
    'stop',
  ])
    expect(parseCommand(action)).not.toBeNull();
});
it('accepts inflections and close pronunciations only as short replacement commands', () => {
  for (const phrase of [
    'changed',
    'changed it',
    'applied',
    'apply now',
    'make the change',
    'aply',
    'appli',
    'chang',
    'chnage',
    'a ply',
    'a play',
    're place',
    'uh changed please',
  ])
    expect(parseCommand(phrase), phrase).toEqual({ action: 'replace', applyCurrent: true });
  for (const phrase of [
    "don't change",
    'do not apply',
    'no change',
    'never apply it',
    'I changed my mind',
    'change it and send',
    'please send this',
    'approv',
    'change alice@example.com',
  ])
    expect(parseCommand(phrase), phrase).toBeNull();
});
it('constructs metadata without copying text, reason, or placeholder and has lessons for every category', () => {
  const m = metadata(
    {
      start: 0,
      end: 17,
      type: 'EMAIL',
      replacement: 'alice@example.com',
      reason: 'Alice salary 123456',
      confidence: 0.99,
      strategy: 'PSEUDONYM',
    },
    'WRITING',
    'SIMPLE',
    'EXPLAIN_RISK',
  );
  expect(Object.keys(m)).toHaveLength(5);
  expect(JSON.stringify(m)).not.toMatch(/alice|123456|@|start|replacement":/i);
  for (const category of categories)
    expect(validateExplanation(localExplanation({ ...m, detected_type: category }))).toBe(true);
  expect(localExplanation({ ...m, detected_type: 'PASSWORD' }).recommended_action).toBe('BLOCK');
  expect(validateExplanation({ ...localExplanation(m), recommended_action: 'SEND' })).toBe(false);
  expect(validateExplanation({ ...localExplanation(m), tool_call: 'send' })).toBe(false);
});
it('undoes and redoes choices and position without changing stable placeholder mappings', () => {
  const history = new ReviewHistory(),
    first = { accepted: [true, false], index: 0 },
    second = { accepted: [false, false], index: 1 };
  history.record(first);
  first.accepted[0] = false;
  expect(history.undo(second)).toEqual({ accepted: [true, false], index: 0 });
  expect(history.redo({ accepted: [true, false], index: 0 })).toEqual(second);
  history.record(second);
  expect(history.redo(second)).toBeNull();
});
