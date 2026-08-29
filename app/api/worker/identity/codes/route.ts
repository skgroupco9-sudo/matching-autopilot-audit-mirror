import { getDb } from '@/db';
import { gmailConnections, identityProfiles } from '@/db/schema';
import { findRecentVerificationCodes, refreshGoogleAccessToken } from '@/lib/google-gmail';
import { decryptVaultValue } from '@/lib/identity-vault';
import { identityVaultContext } from '@/lib/identity-profile';
import { isKnownWorkerForUser } from '@/lib/worker-user-access';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  let body: { userId?: unknown; serviceHint?: unknown };
  try {
    body = await request.json() as { userId?: unknown; serviceHint?: unknown };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (!await isKnownWorkerForUser(request, userId)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const serviceHint = typeof body.serviceHint === 'string' ? body.serviceHint.trim().normalize('NFKC').slice(0, 80) : '';
  const [connectionRows, profileRows] = await Promise.all([
    getDb().select().from(gmailConnections).where(eq(gmailConnections.userId, userId)).limit(1),
    getDb().select({ enabled: identityProfiles.gmailCodeAssistEnabled }).from(identityProfiles).where(eq(identityProfiles.userId, userId)).limit(1),
  ]);
  const connection = connectionRows[0];
  if (!connection || connection.status !== 'connected' || !profileRows[0]?.enabled) {
    return Response.json({ error: 'gmail_code_assist_unavailable' }, { status: 409 });
  }
  if (connection.lastSyncedAt && Date.now() - connection.lastSyncedAt.getTime() < 5_000) {
    return Response.json({ error: 'gmail_check_too_frequent' }, { status: 429, headers: { 'retry-after': '5' } });
  }
  try {
    const refreshToken = await decryptVaultValue(connection.refreshTokenCiphertext, identityVaultContext(userId, 'gmail_refresh_token'));
    const accessToken = await refreshGoogleAccessToken(refreshToken);
    const codes = await findRecentVerificationCodes(accessToken, { serviceHint, maxAgeMinutes: 15 });
    const now = new Date();
    await getDb().update(gmailConnections).set({ status: 'connected', lastSyncedAt: now, lastError: null, updatedAt: now }).where(eq(gmailConnections.userId, userId));
    return Response.json({ codes }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'gmail_access_failed' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
