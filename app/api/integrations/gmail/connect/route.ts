import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { gmailOAuthStates } from '@/db/schema';
import { createGoogleAuthorizationUrl, isGoogleGmailConfigured } from '@/lib/google-gmail';
import { sha256Base64Url } from '@/lib/identity-vault';
import { validateSameOriginMutation } from '@/lib/request-security';
import { lt } from 'drizzle-orm';

export async function POST(request: Request) {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  if (!isGoogleGmailConfigured()) return Response.json({ error: 'gmail_oauth_not_configured' }, { status: 503 });

  const now = new Date();
  const state = randomBase64Url(32);
  const stateHash = await sha256Base64Url(state);
  await getDb().batch([
    getDb().delete(gmailOAuthStates).where(lt(gmailOAuthStates.expiresAt, now)),
    getDb().insert(gmailOAuthStates).values({
      stateHash,
      userId: authenticatedUser.userId,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      createdAt: now,
    }),
  ]);
  const redirectUri = `${new URL(request.url).origin}/api/integrations/gmail/callback`;
  return Response.json({ url: createGoogleAuthorizationUrl(redirectUri, state, authenticatedUser.email) }, {
    headers: { 'cache-control': 'no-store' },
  });
}

function randomBase64Url(length: number) {
  let binary = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(length))) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}
