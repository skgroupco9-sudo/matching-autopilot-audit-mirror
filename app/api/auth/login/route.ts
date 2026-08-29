import { getDb } from '@/db';
import { authRateLimits, passwordAccounts, users } from '@/db/schema';
import {
  createPasswordSalt,
  createSessionCookie,
  hashPassword,
  isSessionConfigured,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from '@/app/personal-auth';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { validateJsonMutation } from '@/lib/request-security';
import { createTelegramAuthChallenge } from '@/lib/auth-challenges';
import { authRateLimitKey, clientIpOf, isAuthRateLimited, LOGIN_IP_POLICY, recordAuthRateLimitFailure } from '@/lib/auth-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const DUMMY_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  if (!isSessionConfigured()) return Response.json({ error: 'auth_not_configured' }, { status: 503 });
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!isValidEmail(email) || !isValidPassword(password)) {
    return Response.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();
  const keyHash = await clientKey(request, email);
  // メール単位のキーだけでは、単一の発信元から多数のメールアドレスへ試行する場合に
  // 上限が働かない。発信元単位の失敗回数も併せて数える。
  const ipKeyHash = await authRateLimitKey('login_ip', clientIpOf(request));
  const ipGate = await isAuthRateLimited(ipKeyHash, now);
  if (ipGate.blocked) {
    return Response.json({ error: 'too_many_attempts' }, { status: 429, headers: { 'retry-after': String(ipGate.retryAfterSeconds) } });
  }
  const attempts = await db.select().from(authRateLimits).where(eq(authRateLimits.keyHash, keyHash)).limit(1);
  if (attempts[0]?.blockedUntil && attempts[0].blockedUntil > now) {
    return Response.json({ error: 'too_many_attempts' }, { status: 429, headers: { 'retry-after': String(Math.ceil((attempts[0].blockedUntil.getTime() - now.getTime()) / 1000)) } });
  }

  const account = await db
    .select({
      userId: passwordAccounts.userId,
      passwordHash: passwordAccounts.passwordHash,
      passwordSalt: passwordAccounts.passwordSalt,
      passwordIterations: passwordAccounts.passwordIterations,
      sessionVersion: passwordAccounts.sessionVersion,
      accountStatus: users.accountStatus,
      telegramMfaEnabled: users.telegramMfaEnabled,
      telegramChatId: users.telegramChatId,
    })
    .from(passwordAccounts)
    .innerJoin(users, eq(users.id, passwordAccounts.userId))
    .where(eq(passwordAccounts.emailNormalized, email))
    .limit(1);
  const passwordMatches = account[0]
    ? await verifyPassword(password, account[0].passwordHash, account[0].passwordSalt, account[0].passwordIterations)
    : await verifyPassword(password, DUMMY_HASH, DUMMY_SALT, PASSWORD_ITERATIONS);

  if (!account[0] || !passwordMatches) {
    const inCurrentWindow = attempts[0] && now.getTime() - attempts[0].windowStartedAt.getTime() < WINDOW_MS;
    const failures = inCurrentWindow ? attempts[0].failures + 1 : 1;
    const windowStartedAt = inCurrentWindow ? attempts[0].windowStartedAt : now;
    const blockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + WINDOW_MS) : null;
    await db.insert(authRateLimits).values({ keyHash, failures, windowStartedAt, blockedUntil, updatedAt: now }).onConflictDoUpdate({
      target: authRateLimits.keyHash,
      set: { failures, windowStartedAt, blockedUntil, updatedAt: now },
    });
    const ipFailure = await recordAuthRateLimitFailure(ipKeyHash, LOGIN_IP_POLICY, now);
    if (ipFailure.blocked) {
      return Response.json({ error: 'too_many_attempts' }, { status: 429, headers: { 'retry-after': String(ipFailure.retryAfterSeconds) } });
    }
    return Response.json({ error: blockedUntil ? 'too_many_attempts' : 'invalid_credentials' }, { status: blockedUntil ? 429 : 401 });
  }

  if (account[0].accountStatus !== 'active') {
    return Response.json({ error: 'account_suspended' }, { status: 403 });
  }

  await db.delete(authRateLimits).where(eq(authRateLimits.keyHash, keyHash));
  if (account[0].telegramMfaEnabled && account[0].telegramChatId) {
    try {
      const challenge = await createTelegramAuthChallenge(account[0].userId, 'login_mfa');
      return Response.json({ mfaRequired: true, challengeId: challenge.id, delivery: 'telegram' }, { status: 202, headers: { 'cache-control': 'no-store' } });
    } catch {
      return Response.json({ error: 'mfa_delivery_failed' }, { status: 503 });
    }
  }
  if (account[0].passwordIterations < PASSWORD_ITERATIONS) {
    const passwordSalt = createPasswordSalt();
    await db.update(passwordAccounts).set({
      passwordHash: await hashPassword(password, passwordSalt),
      passwordSalt,
      passwordIterations: PASSWORD_ITERATIONS,
      lastLoginAt: now,
      updatedAt: now,
    }).where(eq(passwordAccounts.userId, account[0].userId));
  } else {
    await db.update(passwordAccounts).set({ lastLoginAt: now, updatedAt: now }).where(eq(passwordAccounts.userId, account[0].userId));
  }
  return Response.json({ ok: true }, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': await createSessionCookie(account[0].userId, account[0].sessionVersion),
    },
  });
}

async function clientKey(request: Request, email: string) {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const secret = env.MATCHPILOT_SESSION_SECRET;
  if (!secret) throw new Error('session_secret_not_configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`login:${ip.slice(0, 100)}:${email}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
