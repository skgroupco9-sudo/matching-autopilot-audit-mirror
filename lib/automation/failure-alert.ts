import { getDb } from '@/db';
import { reports, users } from '@/db/schema';
import { sendTelegramReport } from '@/lib/telegram';
import { eq } from 'drizzle-orm';

export async function sendTerminalFailureAlert(input: { userId: string; jobId: string; type: string; error?: string | null; now: Date }) {
  const db = getDb();
  const reportId = `failure_${input.jobId}`.slice(0, 120);
  const existing = await db.select({ status: reports.status }).from(reports).where(eq(reports.id, reportId)).limit(1);
  if (existing[0]?.status === 'sent') return;
  const recipient = await db.select({ chatId: users.telegramChatId }).from(users).where(eq(users.id, input.userId)).limit(1);
  const text = ['⚠️ MatchPilotが処理を安全停止しました', '', `処理：${friendlyJobType(input.type)}`, `理由：${sanitizeError(input.error)}`, '', '自動再試行の上限に達したため、勝手に続行していません。管理画面の監査ログを確認してください。'].join('\n');
  await db.insert(reports).values({ id: reportId, userId: input.userId, kind: 'automation_failure', text, status: 'pending', createdAt: input.now }).onConflictDoUpdate({ target: reports.id, set: { text, status: 'pending' } });
  if (!recipient[0]?.chatId) return;
  try {
    const sent = await sendTelegramReport({ chatId: recipient[0].chatId, text });
    await db.update(reports).set({ status: 'sent', telegramMessageId: sent.result?.message_id?.toString() }).where(eq(reports.id, reportId));
  } catch {
    await db.update(reports).set({ status: 'failed' }).where(eq(reports.id, reportId));
  }
}

function sanitizeError(value?: string | null) {
  const text = value?.replace(/[\r\n\t]+/g, ' ').replace(/(?:sk|pk|rk)_[A-Za-z0-9_-]{12,}/g, '[secret]').trim();
  return text ? text.slice(0, 180) : '詳細なし';
}

function friendlyJobType(type: string) {
  return ({ start_session: 'サービス接続', like_contact: 'いいね', send_message: '返信送信', send_approved_reply: '承認済み返信', generate_reply: 'AI返信生成', block_contact: 'LINE受領後のブロック' } as Record<string, string>)[type] ?? type.slice(0, 80);
}
