import { getDb } from '@/db';
import { authChallenges, users } from '@/db/schema';
import { sendTelegramReport } from '@/lib/telegram';
import { secretsEqual } from '@/lib/worker-auth';
import { env } from 'cloudflare:workers';
import { and, eq, isNull } from 'drizzle-orm';
import { AUTH_CHALLENGE_MAX_ATTEMPTS, AUTH_CHALLENGE_RESEND_COOLDOWN_MS, AUTH_CHALLENGE_TTL_MS, isAuthCode } from '@/lib/auth-challenge-policy';

export type AuthChallengeKind = 'login_mfa' | 'password_reset';
export { AUTH_CHALLENGE_MAX_ATTEMPTS, AUTH_CHALLENGE_TTL_MS, isAuthCode } from '@/lib/auth-challenge-policy';

export async function createTelegramAuthChallenge(userId: string, kind: AuthChallengeKind) {
  const db = getDb();
  const recipient = await db
    .select({ chatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const chatId = recipient[0]?.chatId;
  if (!chatId) throw new Error('telegram_not_linked');

  const id = `challenge_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date();
  const current = await db.select().from(authChallenges).where(and(eq(authChallenges.userId, userId), eq(authChallenges.kind, kind))).limit(1);
  if (current[0] && !current[0].consumedAt && current[0].expiresAt > now && now.getTime() - current[0].createdAt.getTime() < AUTH_CHALLENGE_RESEND_COOLDOWN_MS) {
    return { id: current[0].id, expiresAt: current[0].expiresAt };
  }
  const code = generateAuthCode();
  const expiresAt = new Date(now.getTime() + AUTH_CHALLENGE_TTL_MS);
  await db.delete(authChallenges).where(and(eq(authChallenges.userId, userId), eq(authChallenges.kind, kind)));
  await db.insert(authChallenges).values({
    id,
    userId,
    kind,
    codeHash: await hashAuthCode(id, userId, code),
    attempts: 0,
    expiresAt,
    consumedAt: null,
    createdAt: now,
  });

  const purpose = kind === 'login_mfa' ? 'ログイン確認' : 'パスワード再設定';
  try {
    await sendTelegramReport({
      chatId,
      text: [`🔐 MatchPilot ${purpose}`, '', `確認コード：${code}`, '有効時間：10分', '', '心当たりがなければ入力せず、管理者パスワードを変更してください。'].join('\n'),
    });
  } catch (error) {
    await db.delete(authChallenges).where(eq(authChallenges.id, id));
    throw error;
  }
  return { id, expiresAt };
}

export async function consumeTelegramAuthChallenge(id: string, kind: AuthChallengeKind, code: string) {
  if (!/^challenge_[a-f0-9]{32}$/.test(id) || !isAuthCode(code)) return null;
  const db = getDb();
  const rows = await db.select().from(authChallenges).where(and(eq(authChallenges.id, id), eq(authChallenges.kind, kind))).limit(1);
  const challenge = rows[0];
  if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now() || challenge.attempts >= AUTH_CHALLENGE_MAX_ATTEMPTS) return null;
  const valid = secretsEqual(challenge.codeHash, await hashAuthCode(challenge.id, challenge.userId, code));
  if (!valid) {
    await db.update(authChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(authChallenges.id, challenge.id));
    return null;
  }
  const consumedAt = new Date();
  const consumed = await db
    .update(authChallenges)
    .set({ consumedAt })
    .where(and(eq(authChallenges.id, challenge.id), eq(authChallenges.attempts, challenge.attempts), isNull(authChallenges.consumedAt)))
    .returning({ userId: authChallenges.userId });
  return consumed[0]?.userId ?? null;
}

function generateAuthCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, '0');
}

async function hashAuthCode(id: string, userId: string, code: string) {
  const secret = env.MATCHPILOT_SESSION_SECRET;
  if (!secret) throw new Error('session_secret_not_configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}:${userId}:${code}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
