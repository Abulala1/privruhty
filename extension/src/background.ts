import { detectLocally, type Scan } from './core';
import {
  assignMappings,
  includeKnownTerms,
  restoreParts,
  TTL,
  secretType,
  type Entry,
} from './bank';
import {
  deriveKey,
  encryptWithKey,
  decryptWithKey,
  fromBase64,
  toBase64,
  validateEnvelope,
  type Envelope,
} from './crypto';
import { supportedPage, pageScope, restorePageBatch, type PageGrant } from './pageView';
import { categories, validateExplanation } from './voiceguard';

let entries: Entry[] = [];
let expiresAt = Date.now() + TTL;
let key: CryptoKey | null = null;
let salt = '';
let queue = Promise.resolve();
let bankRevision = 0;
const storageKey = 'encryptedWordBank';
const pageGrants = new Map<number, PageGrant>();
const appliedScopes = new Map<number, string>();
function revokePageViews() {
  for (const tabId of pageGrants.keys())
    void chrome.tabs
      .sendMessage(tabId, { kind: 'page-view-changed', enabled: false })
      .catch(() => {});
  pageGrants.clear();
}
chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
const extensionPage = (sender: chrome.runtime.MessageSender) =>
  !!sender.url?.startsWith(chrome.runtime.getURL(''));
async function expire() {
  const stored = (await chrome.storage.local.get(storageKey))[storageKey];
  if (Date.now() >= expiresAt) {
    revokePageViews();
    entries = [];
    key = null;
    salt = '';
    expiresAt = Date.now() + TTL;
  }
  if (stored && stored.expiresAt <= Date.now()) await chrome.storage.local.remove(storageKey);
}
async function persist() {
  if (key) {
    const envelope = await encryptWithKey({ entries, expiresAt }, key, salt, 'word-bank');
    await chrome.storage.local.set({ [storageKey]: { envelope, expiresAt } });
  }
}
async function run(message: any, sender: chrome.runtime.MessageSender) {
  await expire();
  const ui = extensionPage(sender);
  const tabId = sender.tab?.id;
  const contentPage =
    !ui &&
    tabId !== undefined &&
    sender.url &&
    supportedPage(sender.url) &&
    (!sender.frameId || sender.frameId === 0);
  if (message.kind === 'explain-risk') {
    if (!ui && !contentPage) throw new Error('Unsupported review context.');
    const m = message.metadata;
    if (
      message.consent !== true ||
      !m ||
      Object.keys(m).sort().join(',') !==
        'detected_type,explanation_level,question_type,suggested_strategy,task_type' ||
      !categories.includes(m.detected_type) ||
      !['GENERAL', 'WRITING', 'CALCULATION', 'DATA_ANALYSIS', 'MEDICAL'].includes(m.task_type) ||
      !['PSEUDONYM', 'BLOCK', 'MANUAL_REVIEW', 'KEEP'].includes(m.suggested_strategy) ||
      !['SIMPLE', 'DETAILED', 'LEARN_MORE'].includes(m.explanation_level) ||
      ![
        'EXPLAIN_RISK',
        'EXPLAIN_REPLACEMENT',
        'EXPLAIN_PHISHING',
        'EXPLAIN_CORRECTNESS',
        'SIMPLIFY',
        'GIVE_EXAMPLE',
      ].includes(m.question_type)
    )
      throw new Error('Only approved category metadata may be sent.');
    const { token } = await chrome.storage.local.get('token');
    if (!token) return { source: 'unavailable' };
    try {
      const response = await fetch('http://127.0.0.1:8765/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pribruhty-token': token },
        body: JSON.stringify({ ...m, consent: true }),
        signal: AbortSignal.timeout(17000),
      });
      if (!response.ok) return { source: 'unavailable' };
      const result = await response.json();
      return result.source === 'gemini' && validateExplanation(result.explanation)
        ? result
        : { source: 'unavailable' };
    } catch {
      return { source: 'unavailable' };
    }
  }
  if (message.kind === 'protected-applied') {
    if (!contentPage) throw new Error('Unsupported chat page.');
    const scope = String(message.scope || pageScope(sender.url!));
    if (
      (scope === 'composer' || new URL(scope).origin === new URL(sender.url!).origin) &&
      entries.some((e) => e.scope === scope && e.original)
    )
      appliedScopes.set(tabId!, scope);
    return { ok: true };
  }
  if (message.kind === 'page-view-status') {
    if (!contentPage) return { enabled: false };
    const grant = pageGrants.get(tabId!);
    const locked = !!(await chrome.storage.local.get(storageKey))[storageKey] && !key;
    return {
      enabled: !!grant && grant.pageScope === pageScope(sender.url!) && !locked,
      sourceScope: grant?.sourceScope,
      revision: bankRevision,
    };
  }
  if (message.kind === 'page-view-disable') {
    if (!contentPage) throw new Error('Unsupported chat page.');
    pageGrants.delete(tabId!);
    return { ok: true };
  }
  if (message.kind === 'page-view-toggle') {
    if (!contentPage) throw new Error('Unsupported chat page.');
    const scope = pageScope(sender.url!);
    if (pageGrants.get(tabId!)?.pageScope === scope) {
      pageGrants.delete(tabId!);
      return { ok: true };
    }
    if ((await chrome.storage.local.get(storageKey))[storageKey] && !key)
      throw new Error('Unlock your word bank to show originals.');
    const origin = new URL(sender.url!).origin;
    const scopes = [
      ...new Set(
        entries
          .filter((e) => e.original && (e.scope === 'composer' || e.scope.startsWith(origin + '/')))
          .map((e) => e.scope),
      ),
    ];
    const applied = appliedScopes.get(tabId!) || '';
    const sourceScope = scopes.includes(scope)
      ? scope
      : scopes.includes(applied)
        ? applied
        : scopes.length === 1
          ? scopes[0]
          : '';
    if (!sourceScope)
      throw new Error(
        scopes.length
          ? 'Choose this chat’s workspace in the Privruhty popup.'
          : 'No saved originals. Open Word bank to check your mappings.',
      );
    pageGrants.set(tabId!, { pageScope: scope, sourceScope });
    return { ok: true };
  }
  if (message.kind === 'page-restore') {
    const grant = tabId === undefined ? undefined : pageGrants.get(tabId);
    if (!contentPage || !grant || grant.pageScope !== pageScope(sender.url!))
      throw new Error('Enable on-page original words for this chat first.');
    if ((await chrome.storage.local.get(storageKey))[storageKey] && !key)
      throw new Error('Unlock the word bank first.');
    const texts = restorePageBatch(message.texts, grant.sourceScope, entries);
    return {
      texts,
      parts: (message.texts as string[]).map((text) =>
        restoreParts(text, grant.sourceScope, entries),
      ),
    };
  }
  if (message.kind === 'open-bank') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('wordbank.html') });
    return { ok: true };
  }
  if (message.kind === 'scan') {
    if (typeof message.text !== 'string' || message.text.length > 1_000_000)
      throw new Error('Draft is empty or too large.');
    const scope = ui
      ? String(message.scope || 'composer').slice(0, 500)
      : sender.url
        ? new URL(sender.url).origin + new URL(sender.url).pathname
        : '';
    if (!scope) throw new Error('Unsupported scan context.');
    const stored = (await chrome.storage.local.get(storageKey))[storageKey];
    const detected = await detectLocally(message.text);
    // Do not merge a new anonymous session with a locked encrypted bank.
    if (stored && !key)
      return {
        ...detected,
        scope,
        safe_to_submit: false,
        warnings: [
          ...detected.warnings,
          'Word bank is locked. Unlock it before applying changes so placeholders keep the correct meanings.',
        ],
      };
    const oldSize = entries.length;
    const result = assignMappings(
      includeKnownTerms(detected, message.text, scope, entries),
      message.text,
      scope,
      entries,
    );
    if (entries.length !== oldSize) bankRevision++;
    await persist();
    return { ...result, scope };
  }
  // Full bank access is reserved for extension pages. On-page restoration above
  // requires an explicit per-tab, per-conversation grant from the popup.
  if (!ui) throw new Error('This action is available only inside Privruhty.');
  if (message.kind === 'page-view-info' || message.kind === 'page-view-set') {
    if (!Number.isInteger(message.tabId)) throw new Error('Open a supported AI chat tab.');
    const tab = await chrome.tabs.get(message.tabId);
    if (!tab.url || !supportedPage(tab.url))
      throw new Error('Open ChatGPT, Claude, or Gemini first.');
    const scope = pageScope(tab.url),
      origin = new URL(tab.url).origin;
    const stored = (await chrome.storage.local.get(storageKey))[storageKey],
      locked = !!stored && !key;
    const scopes = [
      ...new Set(
        entries
          .filter((e) => e.original && (e.scope === 'composer' || e.scope.startsWith(origin + '/')))
          .map((e) => e.scope),
      ),
    ];
    const grant = pageGrants.get(message.tabId);
    const preferred =
      grant?.pageScope === scope
        ? grant.sourceScope
        : scopes.includes(scope)
          ? scope
          : scopes.includes(appliedScopes.get(message.tabId) || '')
            ? appliedScopes.get(message.tabId)!
            : scopes.length === 1
              ? scopes[0]
              : '';
    if (message.kind === 'page-view-set') {
      if (message.enabled) {
        if (locked) throw new Error('Unlock your word bank before showing original words.');
        if (!scopes.includes(message.sourceScope))
          throw new Error('Choose the word bank used to protect this conversation.');
        pageGrants.set(message.tabId, { pageScope: scope, sourceScope: message.sourceScope });
      } else pageGrants.delete(message.tabId);
      void chrome.tabs
        .sendMessage(message.tabId, { kind: 'page-view-changed', enabled: !!message.enabled })
        .catch(() => {});
      return { ok: true };
    }
    return {
      enabled: !locked && grant?.pageScope === scope,
      locked,
      scopes,
      sourceScope: preferred,
    };
  }
  if (message.kind === 'bank-status') {
    const stored = (await chrome.storage.local.get(storageKey))[storageKey];
    return {
      mode: stored ? (key ? 'unlocked' : 'locked') : 'temporary',
      expiresAt: stored?.expiresAt || expiresAt,
      entries: stored && !key ? [] : entries.filter((e) => e.original),
    };
  }
  if (message.kind === 'bank-unlock') {
    if (typeof message.passphrase !== 'string') throw new Error('Enter a passphrase.');
    const stored = (await chrome.storage.local.get(storageKey))[storageKey];
    if (stored) {
      validateEnvelope(stored.envelope, 'word-bank');
      const nextKey = await deriveKey(message.passphrase, fromBase64(stored.envelope.salt));
      const decrypted = await decryptWithKey<{ entries: Entry[]; expiresAt: number }>(
        stored.envelope,
        nextKey,
      ).catch(() => {
        throw new Error('Incorrect passphrase or damaged word bank.');
      });
      if (
        !Array.isArray(decrypted.entries) ||
        decrypted.entries.length > 2000 ||
        decrypted.expiresAt !== stored.expiresAt ||
        decrypted.expiresAt <= Date.now()
      )
        throw new Error('Expired or invalid word bank.');
      if (
        decrypted.entries.some(
          (e) =>
            typeof e.original !== 'string' ||
            typeof e.scope !== 'string' ||
            !/^[A-Z][A-Z_]*_\d+$/.test(e.replacement) ||
            secretType(e.type),
        )
      )
        throw new Error('Invalid word bank entries.');
      entries = decrypted.entries;
      expiresAt = decrypted.expiresAt;
      key = nextKey;
      salt = stored.envelope.salt;
    } else {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(message.passphrase, bytes);
      salt = toBase64(bytes);
      await persist();
    }
    return { ok: true };
  }
  if (message.kind === 'bank-lock') {
    const stored = (await chrome.storage.local.get(storageKey))[storageKey];
    if (!stored) throw new Error('Set a passphrase before locking the word bank.');
    revokePageViews();
    key = null;
    entries = [];
    salt = '';
    return { ok: true };
  }
  if (message.kind === 'bank-clear') {
    revokePageViews();
    appliedScopes.clear();
    entries = [];
    key = null;
    salt = '';
    expiresAt = Date.now() + TTL;
    await chrome.storage.local.remove(storageKey);
    return { ok: true };
  }
  if (message.kind === 'bank-delete') {
    if ((await chrome.storage.local.get(storageKey))[storageKey] && !key)
      throw new Error('Unlock the bank first.');
    revokePageViews();
    entries = entries.map((e) => (e.id === message.id ? { ...e, original: '' } : e));
    await persist();
    return { ok: true };
  }
  if (message.kind === 'bank-add') {
    if ((await chrome.storage.local.get(storageKey))[storageKey] && !key)
      throw new Error('Unlock the bank first.');
    const { original, type, scope } = message;
    if (
      typeof original !== 'string' ||
      !original.trim() ||
      original.length > 100 ||
      !['PERSON', 'COMPANY', 'CUSTOM'].includes(type) ||
      typeof scope !== 'string' ||
      !scope ||
      scope.length > 500
    )
      throw new Error('Enter a name or term, a category, and a workspace.');
    if ((await detectLocally(original)).spans.some((s) => s.strategy === 'BLOCK'))
      throw new Error('Credentials cannot be stored or restored.');
    assignMappings(
      {
        task: 'GENERAL',
        spans: [
          {
            start: 0,
            end: original.length,
            type,
            confidence: 1,
            replacement: `${type}_1`,
            strategy: 'PSEUDONYM',
            reason: 'Word bank term.',
          },
        ],
        protected: original,
        warnings: [],
        safe_to_submit: true,
      },
      original,
      scope,
      entries,
    );
    bankRevision++;
    await persist();
    return { ok: true };
  }
  if (message.kind === 'restore') {
    if ((await chrome.storage.local.get(storageKey))[storageKey] && !key)
      throw new Error('Unlock the word bank to restore text.');
    if (typeof message.text !== 'string' || message.text.length > 1_000_000)
      throw new Error('Text is too large.');
    return restoreParts(message.text, String(message.scope || 'composer'), entries);
  }
  throw new Error('Unsupported operation.');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Serialize state changes so parallel scans cannot reuse a placeholder for different people.
  queue = queue.then(async () => {
    try {
      reply(await run(message, sender));
    } catch (error) {
      reply({ error: error instanceof Error ? error.message : 'Operation failed.' });
    }
  });
  return true;
});
