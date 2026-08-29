import { getD1, getDb } from '@/db';
import { authChallenges, users } from '@/db/schema';
import { sendTelegramReport } from '@/lib/telegram';
import { secretsEqual } from '@/lib/worker-auth';
import { env } from 'cloudflare:workers';
import { and, eq, isNull } from 'drizzle-orm';
import { AUTH_CHALLENGE_MAX_ATTEMPTS, AUTH_CHALLENGE_RESEND_COOLDOWN_MS, AUTH_CHALLENGE_TTL_MS, CLAIM_AUTH_CHALLENGE_ATTEMPT_SQL, isAuthCode } from '@/lib/auth-challenge-policy';

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
  // 検証の前に試行枠をデータベース側で1つ確保する。読み取り後に加算する実装では、
  // 並行要求が同じ attempts を読んで同じ値を書き戻すため上限を超えられた。
  const claimed = await getD1()
    .prepare(CLAIM_AUTH_CHALLENGE_ATTEMPT_SQL)
    .bind(id, kind, Date.now(), AUTH_CHALLENGE_MAX_ATTEMPTS)
    .first<{ user_id: string; code_hash: string; attempts: number }>();
  // 枠が取れない場合は、存在しない・期限切れ・消費済み・上限到達のいずれか。
  // 区別せず同じ null を返し、状態を推測させない。
  if (!claimed) return null;
  const valid = secretsEqual(claimed.code_hash, await hashAuthCode(id, claimed.user_id, code));
  if (!valid) return null;
  const consumedAt = new Date();
  const consumed = await db
    .update(authChallenges)
    .set({ consumedAt })
    .where(and(eq(authChallenges.id, id), isNull(authChallenges.consumedAt)))
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
