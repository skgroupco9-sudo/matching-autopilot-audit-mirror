import { getDb } from '@/db';
import { authRateLimits } from '@/db/schema';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { nextAuthRateLimitState, type AuthRateLimitPolicy } from '@/lib/auth-rate-limit-policy';

export { RECOVERY_ACCOUNT_POLICY, RECOVERY_IP_POLICY } from '@/lib/auth-rate-limit-policy';

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
export async function consumeAuthRateLimit(keyHash: string, policy: AuthRateLimitPolicy, now: Date) {
  const db = getDb();
  const rows = await db.select().from(authRateLimits).where(eq(authRateLimits.keyHash, keyHash)).limit(1);
  const decision = nextAuthRateLimitState(rows[0], now, policy);
  if (decision.next) {
    await db
      .insert(authRateLimits)
      .values({ keyHash, failures: decision.next.failures, windowStartedAt: decision.next.windowStartedAt, blockedUntil: decision.next.blockedUntil, updatedAt: now })
      .onConflictDoUpdate({
        target: authRateLimits.keyHash,
        set: { failures: decision.next.failures, windowStartedAt: decision.next.windowStartedAt, blockedUntil: decision.next.blockedUntil, updatedAt: now },
      });
  }
  return decision;
}
