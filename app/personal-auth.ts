import { getDb } from '@/db';
import { passwordAccounts, users } from '@/db/schema';
import { secretsEqual } from '@/lib/worker-auth';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { PASSWORD_ITERATIONS } from '@/lib/password-policy';
import { unicodeLength } from '@/lib/unicode-text';

export { PASSWORD_ITERATIONS } from '@/lib/password-policy';

export type PersonalUser = {
  userId: string;
  displayName: string;
  email: string;
  role: 'admin' | 'user';
};

export const PERSONAL_USER_ID = 'personal_owner';
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const COOKIE_NAME = 'matchpilot_session';
const SETUP_COOKIE_NAME = 'matchpilot_setup';
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const THIRTY_MINUTES_SECONDS = 60 * 30;

export async function getPersonalUser(): Promise<PersonalUser | null> {
  const sessionSecret = env.MATCHPILOT_SESSION_SECRET;
  if (!sessionSecret) return null;
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = await sign(payload, sessionSecret);
  if (!secretsEqual(signature, expected)) return null;

  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as { sub?: string; exp?: number; sv?: number };
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000) || typeof claims.sv !== 'number') return null;
    const account = await getDb()
      .select({
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        role: users.role,
        accountStatus: users.accountStatus,
        sessionVersion: passwordAccounts.sessionVersion,
      })
      .from(passwordAccounts)
      .innerJoin(users, eq(users.id, passwordAccounts.userId))
      .where(eq(passwordAccounts.userId, claims.sub))
      .limit(1);
    if (!account[0] || account[0].sessionVersion !== claims.sv || account[0].accountStatus !== 'active') return null;
    return {
      userId: account[0].userId,
      displayName: account[0].displayName?.trim() || 'オーナー',
      email: account[0].email,
      role: account[0].role,
    };
  } catch {
    return null;
  }
}

export function isSessionConfigured() {
  return Boolean(env.MATCHPILOT_SESSION_SECRET);
}

export function isSetupConfigured() {
  return Boolean(env.MATCHPILOT_SETUP_SECRET && env.MATCHPILOT_SESSION_SECRET);
}

export function verifySetupToken(setupToken: string) {
  const configured = env.MATCHPILOT_SETUP_SECRET;
  return Boolean(configured && setupToken.length <= 200 && secretsEqual(setupToken, configured));
}

export async function createSetupAccessCookie() {
  const sessionSecret = env.MATCHPILOT_SESSION_SECRET;
  if (!sessionSecret) throw new Error('session_secret_not_configured');
  const payload = encodeBase64Url(JSON.stringify({
    purpose: 'initial_setup',
    exp: Math.floor(Date.now() / 1000) + THIRTY_MINUTES_SECONDS,
  }));
  const value = `${payload}.${await sign(payload, sessionSecret)}`;
  return serializeNamedCookie(SETUP_COOKIE_NAME, value, THIRTY_MINUTES_SECONDS);
}

export async function hasSetupAccess() {
  const sessionSecret = env.MATCHPILOT_SESSION_SECRET;
  if (!sessionSecret) return false;
  const cookieStore = await cookies();
  const value = cookieStore.get(SETUP_COOKIE_NAME)?.value;
  if (!value) return false;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return false;
  if (!secretsEqual(signature, await sign(payload, sessionSecret))) return false;
  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as { purpose?: string; exp?: number };
    return claims.purpose === 'initial_setup'
      && typeof claims.exp === 'number'
      && claims.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string) {
  return email.trim().normalize('NFKC').toLowerCase();
}

export function configuredAdminEmail() {
  const value = env.MATCHPILOT_ADMIN_EMAIL?.trim();
  return value ? normalizeEmail(value) : null;
}

export function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string) {
  const length = unicodeLength(password);
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH;
}

export function createPasswordSalt() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: base64UrlToBytes(salt),
    iterations,
  }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function verifyPassword(password: string, expectedHash: string, salt: string, iterations: number) {
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
  const actualHash = await hashPassword(password, salt, iterations);
  return secretsEqual(actualHash, expectedHash);
}

export async function createSessionCookie(userId: string, sessionVersion: number) {
  const sessionSecret = env.MATCHPILOT_SESSION_SECRET;
  if (!sessionSecret) throw new Error('session_secret_not_configured');
  const claims = encodeBase64Url(JSON.stringify({
    sub: userId,
    sv: sessionVersion,
    exp: Math.floor(Date.now() / 1000) + THIRTY_DAYS_SECONDS,
  }));
  return serializeCookie(`${claims}.${await sign(claims, sessionSecret)}`, THIRTY_DAYS_SECONDS);
}

export function clearSessionCookie() {
  return serializeCookie('', 0);
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function encodeBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function decodeBase64Url(value: string) {
  return new TextDecoder().decode(base64UrlToBytes(value));
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

function serializeCookie(value: string, maxAge: number) {
  return serializeNamedCookie(COOKIE_NAME, value, maxAge);
}

function serializeNamedCookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
