import { clearSessionCookie, getPersonalUser, verifyPassword } from '@/app/personal-auth';
import { getDb, getFilesBucket } from '@/db';
import { billingSubscriptions, gmailConnections, passwordAccounts, users } from '@/db/schema';
import { cancelStripeSubscription, isStripeApiConfigured } from '@/lib/stripe-billing';
import { revokeGoogleRefreshToken } from '@/lib/google-gmail';
import { decryptVaultValue } from '@/lib/identity-vault';
import { identityVaultContext } from '@/lib/identity-profile';
import { eq } from 'drizzle-orm';
import { validateJsonMutation } from '@/lib/request-security';
import { unicodeLength } from '@/lib/unicode-text';

const activeSubscriptionStatuses = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']);

export async function DELETE(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });

  let body: { password?: string; confirmation?: string };
  try {
    body = (await request.json()) as { password?: string; confirmation?: string };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (body.confirmation !== '削除' || typeof body.password !== 'string' || unicodeLength(body.password) > 128) {
    return Response.json({ error: 'confirmation_required' }, { status: 400 });
  }

  const db = getDb();
  const account = await db.select({
    passwordHash: passwordAccounts.passwordHash,
    passwordSalt: passwordAccounts.passwordSalt,
    passwordIterations: passwordAccounts.passwordIterations,
  }).from(passwordAccounts).where(eq(passwordAccounts.userId, authenticatedUser.userId)).limit(1);
  if (!account[0] || !await verifyPassword(body.password, account[0].passwordHash, account[0].passwordSalt, account[0].passwordIterations)) {
    return Response.json({ error: 'invalid_password' }, { status: 401 });
  }

  const subscription = await db.select({
    id: billingSubscriptions.stripeSubscriptionId,
    status: billingSubscriptions.status,
  }).from(billingSubscriptions).where(eq(billingSubscriptions.userId, authenticatedUser.userId)).limit(1);

  if (subscription[0] && activeSubscriptionStatuses.has(subscription[0].status)) {
    if (!isStripeApiConfigured()) return Response.json({ error: 'subscription_cancellation_failed' }, { status: 409 });
    try {
      await cancelStripeSubscription(subscription[0].id);
    } catch {
      return Response.json({ error: 'subscription_cancellation_failed' }, { status: 502 });
    }
  }

  try {
    await revokeConnectedGmail(authenticatedUser.userId);
    await deleteUserFiles(authenticatedUser.userId);
    await db.delete(users).where(eq(users.id, authenticatedUser.userId));
  } catch {
    return Response.json({ error: 'deletion_failed' }, { status: 500 });
  }

  return Response.json({ ok: true }, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': clearSessionCookie(),
    },
  });
}

async function revokeConnectedGmail(userId: string) {
  const rows = await getDb().select({ refreshTokenCiphertext: gmailConnections.refreshTokenCiphertext }).from(gmailConnections).where(eq(gmailConnections.userId, userId)).limit(1);
  if (!rows[0]) return;
  try {
    const refreshToken = await decryptVaultValue(rows[0].refreshTokenCiphertext, identityVaultContext(userId, 'gmail_refresh_token'));
    await revokeGoogleRefreshToken(refreshToken);
  } catch {
    // The local account must remain deletable even if Google has already revoked access.
  }
}

async function deleteUserFiles(userId: string) {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const bucket = getFilesBucket();
  for (const prefix of [`screenshots/${safeUserId}/`, `identity-documents/${safeUserId}/`, `identity-profile-photos/${safeUserId}/`, `backups/${safeUserId}/`, `self-tests/${safeUserId}/`]) {
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ prefix, cursor, limit: 1000 });
      if (listed.objects.length > 0) await bucket.delete(listed.objects.map((object) => object.key));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
}
