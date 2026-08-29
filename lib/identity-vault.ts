import { env } from 'cloudflare:workers';

const VERSION = 'v1';
const BINARY_VERSION = 1;
const IV_BYTES = 12;

export function isIdentityVaultConfigured() {
  return Boolean(env.IDENTITY_VAULT_ENCRYPTION_KEY);
}

export async function encryptVaultValue(value: string, context: string) {
  const key = await getVaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(context),
  }, key, new TextEncoder().encode(value));
  return `${VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptVaultValue(value: string | null, context: string) {
  if (!value) return '';
  const [version, encodedIv, encodedCiphertext, extra] = value.split('.');
  if (version !== VERSION || !encodedIv || !encodedCiphertext || extra) throw new Error('invalid_vault_ciphertext');
  const decrypted = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: base64UrlToBytes(encodedIv),
    additionalData: new TextEncoder().encode(context),
  }, await getVaultKey(), base64UrlToBytes(encodedCiphertext));
  return new TextDecoder().decode(decrypted);
}

export async function encryptVaultBytes(value: Uint8Array, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(context),
  }, await getVaultKey(), toArrayBuffer(value)));
  const result = new Uint8Array(1 + IV_BYTES + encrypted.byteLength);
  result[0] = BINARY_VERSION;
  result.set(iv, 1);
  result.set(encrypted, 1 + IV_BYTES);
  return result;
}

export async function decryptVaultBytes(value: ArrayBuffer, context: string) {
  const bytes = new Uint8Array(value);
  if (bytes.byteLength <= 1 + IV_BYTES || bytes[0] !== BINARY_VERSION) throw new Error('invalid_vault_binary');
  const decrypted = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: bytes.slice(1, 1 + IV_BYTES),
    additionalData: new TextEncoder().encode(context),
  }, await getVaultKey(), toArrayBuffer(bytes.slice(1 + IV_BYTES)));
  return new Uint8Array(decrypted);
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function getVaultKey() {
  const encoded = env.IDENTITY_VAULT_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error('identity_vault_not_configured');
  const bytes = base64UrlToBytes(encoded);
  if (bytes.length !== 32) throw new Error('identity_vault_key_invalid');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
