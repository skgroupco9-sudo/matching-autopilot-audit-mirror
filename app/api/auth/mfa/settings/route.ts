import { getPersonalUser, verifyPassword } from '@/app/personal-auth';
import { getDb } from '@/db';
import { passwordAccounts, users } from '@/db/schema';
import { validateJsonMutation } from '@/lib/request-security';
import { sendTelegramReport } from '@/lib/telegram';
import { unicodeLength } from '@/lib/unicode-text';
import { and, eq } from 'drizzle-orm';

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const rows = await getDb().select({ enabled: users.telegramMfaEnabled, telegramLinked: users.telegramChatId }).from(users).where(eq(users.id, user.userId)).limit(1);
  return Response.json({ enabled: rows[0]?.enabled === true, telegramLinked: Boolean(rows[0]?.telegramLinked) }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  let body: { enabled?: boolean; currentPassword?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean' || typeof body.currentPassword !== 'string' || unicodeLength(body.currentPassword) > 128) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  const account = await getDb()
    .select({ hash: passwordAccounts.passwordHash, salt: passwordAccounts.passwordSalt, iterations: passwordAccounts.passwordIterations, chatId: users.telegramChatId })
    .from(passwordAccounts)
    .innerJoin(users, eq(users.id, passwordAccounts.userId))
    .where(eq(passwordAccounts.userId, user.userId))
    .limit(1);
  const row = account[0];
  if (!row || !await verifyPassword(body.currentPassword, row.hash, row.salt, row.iterations)) {
    return Response.json({ error: 'invalid_current_password' }, { status: 401 });
  }
  if (body.enabled && !row.chatId) return Response.json({ error: 'telegram_required' }, { status: 409 });
  await getDb().update(users).set({ telegramMfaEnabled: body.enabled, updatedAt: new Date() }).where(and(eq(users.id, user.userId), eq(users.accountStatus, 'active')));
  if (row.chatId) {
    await sendTelegramReport({ chatId: row.chatId, text: body.enabled ? '✅ MatchPilotのTelegram 2段階認証を有効にしました。' : 'ℹ️ MatchPilotのTelegram 2段階認証を無効にしました。' }).catch(() => undefined);
  }
  return Response.json({ ok: true, enabled: body.enabled });
}
