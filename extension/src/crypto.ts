export type Envelope = {
  version: 1;
  kind: 'word-bank' | 'file';
  salt: string;
  iv: string;
  ciphertext: string;
};
// Version 1 authenticated-data labels retain their original spelling so existing
// encrypted banks and files remain decryptable after the Privruhty rename.
const iterations = 310_000;
const encode = new TextEncoder();
export function toBase64(bytes: Uint8Array) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function deriveKey(passphrase: string, salt: Uint8Array) {
  if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const material = await crypto.subtle.importKey(
    'raw',
    encode.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptWithKey(
  value: unknown,
  key: CryptoKey,
  salt: string,
  kind: Envelope['kind'],
): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encode.encode(`Pribruhty:1:${kind}`) },
    key,
    encode.encode(JSON.stringify(value)),
  );
  return {
    version: 1,
    kind,
    salt,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}
export function validateEnvelope(
  value: unknown,
  kind: Envelope['kind'],
): asserts value is Envelope {
  const e = value as Envelope;
  if (
    !e ||
    e.version !== 1 ||
    e.kind !== kind ||
    typeof e.salt !== 'string' ||
    typeof e.iv !== 'string' ||
    typeof e.ciphertext !== 'string' ||
    e.ciphertext.length > 24_000_000 ||
    fromBase64(e.salt).length !== 16 ||
    fromBase64(e.iv).length !== 12
  )
    throw new Error('Unsupported or damaged encrypted data.');
}
export async function decryptWithKey<T>(envelope: Envelope, key: CryptoKey): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: encode.encode(`Pribruhty:1:${envelope.kind}`),
    },
    key,
    fromBase64(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
export async function seal(value: unknown, passphrase: string, kind: Envelope['kind']) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    key = await deriveKey(passphrase, salt);
  return encryptWithKey(value, key, toBase64(salt), kind);
}
export async function unseal<T>(
  value: unknown,
  passphrase: string,
  kind: Envelope['kind'],
): Promise<T> {
  validateEnvelope(value, kind);
  return decryptWithKey<T>(value, await deriveKey(passphrase, fromBase64(value.salt)));
}
