import { getPersonalUser, verifyPassword } from '@/app/personal-auth';
import { getDb } from '@/db';
import { authRateLimits, passwordAccounts, serviceCredentials } from '@/db/schema';
import { serviceCredentialVaultContext } from '@/lib/identity-profile';
import { decryptVaultValue, sha256Base64Url } from '@/lib/identity-vault';
import { validateJsonMutation } from '@/lib/request-security';
import { unicodeLength } from '@/lib/unicode-text';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const REVEAL_WINDOW_MS = 15 * 60 * 1000;
const MAX_REVEAL_FAILURES = 5;

export async function POST(request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const { credentialId } = await context.params;
  if (!/^cred_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(credentialId)) {
    return Response.json({ error: 'invalid_service_credential' }, { status: 400 });
  }

  let body: { accountPassword?: string };
  try {
    body = await request.json() as { accountPassword?: string };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.accountPassword !== 'string' || unicodeLength(body.accountPassword) > 128) {
    return Response.json({ error: 'account_password_required' }, { status: 400 });
  }

  const now = new Date();
  const rateLimitKey = await sha256Base64Url(`service-credential-reveal:${user.userId}`);
  const attempts = await getDb().select().from(authRateLimits).where(eq(authRateLimits.keyHash, rateLimitKey)).limit(1);
  if (attempts[0]?.blockedUntil && attempts[0].blockedUntil > now) {
    return Response.json({ error: 'too_many_reveal_attempts' }, {
      status: 429,
      headers: { 'cache-control': 'no-store', 'retry-after': String(Math.ceil((attempts[0].blockedUntil.getTime() - now.getTime()) / 1000)) },
    });
  }

  const [account, credential] = await Promise.all([
    getDb().select({
      passwordHash: passwordAccounts.passwordHash,
      passwordSalt: passwordAccounts.passwordSalt,
      passwordIterations: passwordAccounts.passwordIterations,
    }).from(passwordAccounts).where(eq(passwordAccounts.userId, user.userId)).limit(1),
    getDb().select().from(serviceCredentials).where(and(
      eq(serviceCredentials.id, credentialId),
      eq(serviceCredentials.userId, user.userId),
    )).limit(1),
  ]);
  if (!account[0] || !await verifyPassword(body.accountPassword, account[0].passwordHash, account[0].passwordSalt, account[0].passwordIterations)) {
    const activeWindow = attempts[0] && now.getTime() - attempts[0].windowStartedAt.getTime() < REVEAL_WINDOW_MS;
    const failures = activeWindow ? attempts[0].failures + 1 : 1;
    const windowStartedAt = activeWindow ? attempts[0].windowStartedAt : now;
    const blockedUntil = failures >= MAX_REVEAL_FAILURES ? new Date(now.getTime() + REVEAL_WINDOW_MS) : null;
    await getDb().insert(authRateLimits).values({ keyHash: rateLimitKey, failures, windowStartedAt, blockedUntil, updatedAt: now }).onConflictDoUpdate({
      target: authRateLimits.keyHash,
      set: { failures, windowStartedAt, blockedUntil, updatedAt: now },
    });
    return Response.json({ error: 'invalid_account_password' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  if (!credential[0]) return Response.json({ error: 'service_credential_not_found' }, { status: 404 });

  await getDb().delete(authRateLimits).where(eq(authRateLimits.keyHash, rateLimitKey));

  return Response.json({
    loginId: await decryptVaultValue(credential[0].loginIdCiphertext, serviceCredentialVaultContext(user.userId, credentialId, 'login_id')),
    password: await decryptVaultValue(credential[0].passwordCiphertext, serviceCredentialVaultContext(user.userId, credentialId, 'password')),
  }, { headers: { 'cache-control': 'private, no-store' } });
}
