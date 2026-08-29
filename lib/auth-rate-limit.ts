import { getD1, getDb } from '@/db';
import { authRateLimits } from '@/db/schema';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { AUTH_RATE_LIMIT_SQL, decideFromAuthRateLimitRow, type AuthRateLimitPolicy } from '@/lib/auth-rate-limit-policy';

export { AUTH_RATE_LIMIT_SQL, LOGIN_IP_POLICY, RECOVERY_ACCOUNT_POLICY, RECOVERY_IP_POLICY } from '@/lib/auth-rate-limit-policy';

export function clientIpOf(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  ).slice(0, 100);
}

export async function authRateLimitKey(scope: string, subject: string) {
  const secret = env.MATCHPILOT_SESSION_SECRET;
  if (!secret) throw new Error('session_secret_not_configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${scope}:${subject}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// 遮断中なら true を返し、そうでなければ試行を1件加算して記録する。
// 加算は AUTH_RATE_LIMIT_SQL の1文で完結し、戻り値は RETURNING の実値から判定する。
export async function consumeAuthRateLimit(keyHash: string, policy: AuthRateLimitPolicy, now: Date) {
  const nowMs = now.getTime();
  const row = await getD1()
    .prepare(AUTH_RATE_LIMIT_SQL)
    .bind(keyHash, nowMs, policy.windowMs, policy.maxRequests, policy.blockMs)
    .first<{ failures: number; window_started_at: number; blocked_until: number | null }>();
  if (!row) throw new Error('auth_rate_limit_write_failed');
  return decideFromAuthRateLimitRow(row, nowMs);
}

// 記録を増やさずに遮断状態だけを確認する。失敗時のみ計上する経路で使う。
export async function isAuthRateLimited(keyHash: string, now: Date) {
  const db = getDb();
  const rows = await db.select().from(authRateLimits).where(eq(authRateLimits.keyHash, keyHash)).limit(1);
  const blockedUntil = rows[0]?.blockedUntil;
  if (!blockedUntil || blockedUntil.getTime() <= now.getTime()) return { blocked: false, retryAfterSeconds: 0 };
  return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000)) };
}

// 失敗を1件計上する。成功時には呼ばない。
export async function recordAuthRateLimitFailure(keyHash: string, policy: AuthRateLimitPolicy, now: Date) {
  return consumeAuthRateLimit(keyHash, policy, now);
}
