import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { gmailConnections, identityProfiles } from '@/db/schema';
import { revokeGoogleRefreshToken } from '@/lib/google-gmail';
import { decryptVaultValue } from '@/lib/identity-vault';
import { identityVaultContext } from '@/lib/identity-profile';
import { eq } from 'drizzle-orm';
import { validateSameOriginMutation } from '@/lib/request-security';

export async function POST(request: Request) {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const unsafeRequest = validateSameOriginMutation(request);
  if (unsafeRequest) return unsafeRequest;

  const rows = await getDb().select().from(gmailConnections).where(eq(gmailConnections.userId, authenticatedUser.userId)).limit(1);
  const connection = rows[0];
  if (connection) {
    try {
      const refreshToken = await decryptVaultValue(connection.refreshTokenCiphertext, identityVaultContext(authenticatedUser.userId, 'gmail_refresh_token'));
      await revokeGoogleRefreshToken(refreshToken);
    } catch {
      // Local disconnection must still succeed when Google has already revoked the token.
    }
  }
  const now = new Date();
  await getDb().batch([
    getDb().delete(gmailConnections).where(eq(gmailConnections.userId, authenticatedUser.userId)),
    getDb().update(identityProfiles).set({ gmailCodeAssistEnabled: false, updatedAt: now }).where(eq(identityProfiles.userId, authenticatedUser.userId)),
  ]);
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
