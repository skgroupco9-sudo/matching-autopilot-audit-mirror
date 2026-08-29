import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { automationJobs, gmailConnections, identityProfiles } from '@/db/schema';
import { findRecentVerificationCodes, refreshGoogleAccessToken } from '@/lib/google-gmail';
import { decryptVaultValue } from '@/lib/identity-vault';
import { identityVaultContext } from '@/lib/identity-profile';
import { validateJsonMutation } from '@/lib/request-security';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;

  let body: { serviceHint?: unknown; maxAgeMinutes?: unknown };
  try {
    body = await request.json() as { serviceHint?: unknown; maxAgeMinutes?: unknown };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const serviceHint = typeof body.serviceHint === 'string' ? body.serviceHint.trim().normalize('NFKC').slice(0, 80) : '';
  const maxAgeMinutes = typeof body.maxAgeMinutes === 'number' && Number.isInteger(body.maxAgeMinutes)
    ? Math.min(60, Math.max(5, body.maxAgeMinutes))
    : 15;
  const [connectionRows, profileRows] = await Promise.all([
    getDb().select().from(gmailConnections).where(eq(gmailConnections.userId, authenticatedUser.userId)).limit(1),
    getDb().select({ enabled: identityProfiles.gmailCodeAssistEnabled }).from(identityProfiles).where(eq(identityProfiles.userId, authenticatedUser.userId)).limit(1),
  ]);
  const connection = connectionRows[0];
  if (!connection || connection.status !== 'connected') return Response.json({ error: 'gmail_not_connected' }, { status: 409 });
  if (!profileRows[0]?.enabled) return Response.json({ error: 'gmail_code_assist_disabled' }, { status: 409 });
  if (connection.lastSyncedAt && Date.now() - connection.lastSyncedAt.getTime() < 5_000) {
    return Response.json({ error: 'gmail_check_too_frequent' }, { status: 429, headers: { 'retry-after': '5' } });
  }

  try {
    const refreshToken = await decryptVaultValue(connection.refreshTokenCiphertext, identityVaultContext(authenticatedUser.userId, 'gmail_refresh_token'));
    const accessToken = await refreshGoogleAccessToken(refreshToken);
    const codes = await findRecentVerificationCodes(accessToken, { serviceHint, maxAgeMinutes });
    const now = new Date();
    await getDb().batch([
      getDb().update(gmailConnections).set({ status: 'connected', lastSyncedAt: now, lastError: null, updatedAt: now }).where(eq(gmailConnections.userId, authenticatedUser.userId)),
      getDb().insert(automationJobs).values({
        id: `gmail_code_${crypto.randomUUID()}`,
        userId: authenticatedUser.userId,
        connectionId: null,
        type: 'gmail_verification_code_checked',
        payloadJson: JSON.stringify({ serviceHint: serviceHint || null, found: codes.length > 0, maxAgeMinutes }),
        status: 'completed',
        priority: 100,
        attempts: 1,
        runAfter: now,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    return Response.json({ codes }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    const now = new Date();
    await getDb().update(gmailConnections).set({ status: 'error', lastError: 'gmail_access_failed', updatedAt: now }).where(eq(gmailConnections.userId, authenticatedUser.userId));
    return Response.json({ error: 'gmail_access_failed' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
