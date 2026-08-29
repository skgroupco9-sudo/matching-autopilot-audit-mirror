import type { VerificationCodeCandidate } from '@/lib/identity-types';
import { env } from 'cloudflare:workers';

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
};

type GmailMessage = {
  id?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};

type GmailPart = {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
};

export function isGoogleGmailConfigured() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function createGoogleAuthorizationUrl(redirectUri: string, state: string, loginHint?: string) {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId || !env.GOOGLE_CLIENT_SECRET) throw new Error('gmail_oauth_not_configured');
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string) {
  return requestGoogleToken({
    code,
    client_id: requiredGoogleClientId(),
    client_secret: requiredGoogleClientSecret(),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const token = await requestGoogleToken({
    refresh_token: refreshToken,
    client_id: requiredGoogleClientId(),
    client_secret: requiredGoogleClientSecret(),
    grant_type: 'refresh_token',
  });
  if (!token.access_token) throw new Error('gmail_token_refresh_failed');
  return token.access_token;
}

export async function getGmailAddress(accessToken: string) {
  const response = await gmailFetch(`${GMAIL_API_URL}/profile`, accessToken);
  const body = await response.json() as { emailAddress?: string };
  if (!response.ok || !body.emailAddress) throw new Error('gmail_profile_failed');
  return body.emailAddress;
}

export async function findRecentVerificationCodes(accessToken: string, options: { serviceHint?: string; maxAgeMinutes: number }) {
  const query = 'newer_than:1d {subject:認証 subject:確認 subject:コード subject:verification subject:OTP}';
  const listUrl = new URL(`${GMAIL_API_URL}/messages`);
  listUrl.searchParams.set('maxResults', '10');
  listUrl.searchParams.set('q', query);
  const listResponse = await gmailFetch(listUrl.toString(), accessToken);
  const list = await listResponse.json() as { messages?: Array<{ id?: string }> };
  if (!listResponse.ok) throw new Error('gmail_message_list_failed');

  const messageIds = (list.messages ?? []).map((message) => message.id).filter((id): id is string => Boolean(id)).slice(0, 10);
  const messages = await Promise.all(messageIds.map(async (id) => {
    const response = await gmailFetch(`${GMAIL_API_URL}/messages/${encodeURIComponent(id)}?format=full`, accessToken);
    if (!response.ok) return null;
    return response.json() as Promise<GmailMessage>;
  }));

  const now = Date.now();
  const serviceHint = options.serviceHint?.trim().normalize('NFKC').toLocaleLowerCase('ja') ?? '';
  const results: VerificationCodeCandidate[] = [];
  for (const message of messages) {
    if (!message?.internalDate) continue;
    const receivedAt = Number(message.internalDate);
    if (!Number.isFinite(receivedAt) || receivedAt > now + 300_000 || now - receivedAt > options.maxAgeMinutes * 60_000) continue;
    const subject = headerValue(message.payload, 'subject');
    const sender = headerValue(message.payload, 'from');
    const searchableText = `${subject}\n${sender}\n${message.snippet ?? ''}\n${collectPartText(message.payload)}`.normalize('NFKC');
    if (serviceHint && !searchableText.toLocaleLowerCase('ja').includes(serviceHint)) continue;
    const code = extractVerificationCode(searchableText);
    if (!code) continue;
    results.push({ code, subject: subject.slice(0, 160), sender: sender.slice(0, 160), receivedAt: new Date(receivedAt).toISOString() });
  }
  return results.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)).slice(0, 5);
}

export async function revokeGoogleRefreshToken(refreshToken: string) {
  const body = new URLSearchParams({ token: refreshToken });
  await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
}

export function googleScopeIncludesGmail(scope: string | undefined) {
  return Boolean(scope?.split(/\s+/).includes(GMAIL_READONLY_SCOPE));
}

async function requestGoogleToken(parameters: Record<string, string>) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as GoogleTokenResponse;
  if (!response.ok || body.error || !body.access_token) throw new Error('gmail_token_exchange_failed');
  return body;
}

function gmailFetch(url: string, accessToken: string) {
  return fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
}

function requiredGoogleClientId() {
  if (!env.GOOGLE_CLIENT_ID) throw new Error('gmail_oauth_not_configured');
  return env.GOOGLE_CLIENT_ID;
}

function requiredGoogleClientSecret() {
  if (!env.GOOGLE_CLIENT_SECRET) throw new Error('gmail_oauth_not_configured');
  return env.GOOGLE_CLIENT_SECRET;
}

function headerValue(part: GmailPart | undefined, name: string) {
  return part?.headers?.find((header) => header.name?.toLowerCase() === name)?.value ?? '';
}

function collectPartText(part: GmailPart | undefined): string {
  if (!part) return '';
  const ownText = part.body?.data && (!part.mimeType || part.mimeType === 'text/plain' || part.mimeType === 'text/html')
    ? decodeBase64UrlUtf8(part.body.data)
    : '';
  return [ownText, ...(part.parts ?? []).map(collectPartText)].join('\n').replace(/<[^>]*>/g, ' ').slice(0, 30_000);
}

function decodeBase64UrlUtf8(value: string) {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(normalized);
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return '';
  }
}

function extractVerificationCode(value: string) {
  const normalized = value.replace(/\s+/g, ' ');
  const keyword = '(?:認証(?:番号|コード)?|確認(?:番号|コード)?|ワンタイム(?:パスワード|コード)?|verification\s*code|one[- ]?time\s*(?:password|code)|OTP)';
  const after = normalized.match(new RegExp(`${keyword}[^0-9]{0,50}([0-9]{4,8})(?![0-9])`, 'i'));
  if (after?.[1]) return after[1];
  const before = normalized.match(new RegExp(`(?:^|[^0-9])([0-9]{4,8})[^0-9]{0,35}${keyword}`, 'i'));
  return before?.[1] ?? '';
}
