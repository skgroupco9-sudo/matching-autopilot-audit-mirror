import { normalizeEmail, isValidEmail } from '@/app/personal-auth';
import { createTelegramAuthChallenge } from '@/lib/auth-challenges';
import { getDb } from '@/db';
import { passwordAccounts, users } from '@/db/schema';
import { validateJsonMutation } from '@/lib/request-security';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  let body: { email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!isValidEmail(email)) return Response.json({ error: 'invalid_email' }, { status: 400 });
  const account = await getDb()
    .select({ userId: passwordAccounts.userId, status: users.accountStatus, chatId: users.telegramChatId })
    .from(passwordAccounts)
    .innerJoin(users, eq(users.id, passwordAccounts.userId))
    .where(eq(passwordAccounts.emailNormalized, email))
    .limit(1);
  let challengeId = `challenge_${crypto.randomUUID().replaceAll('-', '')}`;
  if (account[0]?.status === 'active' && account[0].chatId) {
    const challenge = await createTelegramAuthChallenge(account[0].userId, 'password_reset').catch(() => null);
    if (challenge) challengeId = challenge.id;
  }
  return Response.json({ ok: true, challengeId }, { headers: { 'cache-control': 'no-store' } });
}
