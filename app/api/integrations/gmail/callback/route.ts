import { getDb } from '@/db';
import { gmailConnections, gmailOAuthStates } from '@/db/schema';
import { exchangeGoogleAuthorizationCode, getGmailAddress, googleScopeIncludesGmail } from '@/lib/google-gmail';
import { encryptVaultValue, sha256Base64Url } from '@/lib/identity-vault';
import { identityVaultContext } from '@/lib/identity-profile';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const state = requestUrl.searchParams.get('state') ?? '';
  const code = requestUrl.searchParams.get('code') ?? '';
  if (!state || state.length > 200 || !code || code.length > 2000 || requestUrl.searchParams.has('error')) {
    return redirectToIdentity(origin, 'denied');
  }

  const stateHash = await sha256Base64Url(state);
  const stateRows = await getDb().select().from(gmailOAuthStates).where(eq(gmailOAuthStates.stateHash, stateHash)).limit(1);
  const oauthState = stateRows[0];
  if (!oauthState || oauthState.expiresAt.getTime() <= Date.now()) {
    if (oauthState) await getDb().delete(gmailOAuthStates).where(eq(gmailOAuthStates.stateHash, stateHash));
    return redirectToIdentity(origin, 'expired');
  }
  await getDb().delete(gmailOAuthStates).where(eq(gmailOAuthStates.stateHash, stateHash));

  try {
    const redirectUri = `${origin}/api/integrations/gmail/callback`;
    const token = await exchangeGoogleAuthorizationCode(code, redirectUri);
    if (!token.access_token || !googleScopeIncludesGmail(token.scope)) throw new Error('gmail_scope_missing');
    const email = await getGmailAddress(token.access_token);
    const existingRows = await getDb().select({ refreshTokenCiphertext: gmailConnections.refreshTokenCiphertext }).from(gmailConnections).where(eq(gmailConnections.userId, oauthState.userId)).limit(1);
    const refreshTokenCiphertext = token.refresh_token
      ? await encryptVaultValue(token.refresh_token, identityVaultContext(oauthState.userId, 'gmail_refresh_token'))
      : existingRows[0]?.refreshTokenCiphertext;
    if (!refreshTokenCiphertext) throw new Error('gmail_refresh_token_missing');
    const now = new Date();
    await getDb().insert(gmailConnections).values({
      userId: oauthState.userId,
      emailCiphertext: await encryptVaultValue(email, identityVaultContext(oauthState.userId, 'gmail_email')),
      refreshTokenCiphertext,
      scope: token.scope ?? '',
      status: 'connected',
      lastSyncedAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: gmailConnections.userId,
      set: {
        emailCiphertext: await encryptVaultValue(email, identityVaultContext(oauthState.userId, 'gmail_email')),
        refreshTokenCiphertext,
        scope: token.scope ?? '',
        status: 'connected',
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      },
    });
    return redirectToIdentity(origin, 'connected');
  } catch {
    return redirectToIdentity(origin, 'error');
  }
}

function redirectToIdentity(origin: string, result: string) {
  return Response.redirect(`${origin}/identity?gmail=${encodeURIComponent(result)}`, 303);
}
