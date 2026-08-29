import { createSessionCookie } from '@/app/personal-auth';
import { consumeTelegramAuthChallenge } from '@/lib/auth-challenges';
import { getDb } from '@/db';
import { passwordAccounts, users } from '@/db/schema';
import { validateJsonMutation } from '@/lib/request-security';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  let body: { challengeId?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const userId = await consumeTelegramAuthChallenge(body.challengeId ?? '', 'login_mfa', body.code ?? '');
  if (!userId) return Response.json({ error: 'invalid_or_expired_code' }, { status: 401 });

  const account = await getDb()
    .select({ sessionVersion: passwordAccounts.sessionVersion, accountStatus: users.accountStatus })
    .from(passwordAccounts)
    .innerJoin(users, eq(users.id, passwordAccounts.userId))
    .where(eq(passwordAccounts.userId, userId))
    .limit(1);
  if (!account[0] || account[0].accountStatus !== 'active') return Response.json({ error: 'account_unavailable' }, { status: 403 });
  await getDb().update(passwordAccounts).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(passwordAccounts.userId, userId));
  return Response.json({ ok: true }, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': await createSessionCookie(userId, account[0].sessionVersion),
    },
  });
}
