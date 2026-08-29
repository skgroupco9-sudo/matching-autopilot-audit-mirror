import { getDb } from '@/db';
import { reports, users } from '@/db/schema';
import { japanDateKey } from '@/lib/backup-policy';
import { sendTelegramReport } from '@/lib/telegram';
import { eq } from 'drizzle-orm';

export async function sendWorkerStatusAlert(userId: string, workerId: string, status: 'degraded' | 'offline' | 'recovered', now: Date) {
  const db = getDb();
  const reportId = `worker_${japanDateKey(now)}_${status}_${workerId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const existing = await db.select({ status: reports.status }).from(reports).where(eq(reports.id, reportId)).limit(1);
  if (existing[0]?.status === 'sent') return;
  const recipient = await db.select({ chatId: users.telegramChatId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!recipient[0]?.chatId) return;
  const text = status === 'recovered'
    ? '✅ MatchPilotワーカーが復旧し、自動巡回を再開できる状態になりました。'
    : status === 'degraded'
      ? '⚠️ MatchPilotワーカーは起動中ですが、AIキーなどの不足設定があります。管理画面の運転準備診断を確認してください。'
      : '⏸ MatchPilotワーカーを停止しました。停止中は外部サービスの巡回・送信を行いません。';
  await db.insert(reports).values({ id: reportId, userId, kind: 'worker_status', text, status: 'pending', createdAt: now }).onConflictDoUpdate({ target: reports.id, set: { text, status: 'pending' } });
  try {
    const sent = await sendTelegramReport({ chatId: recipient[0].chatId, text });
    await db.update(reports).set({ status: 'sent', telegramMessageId: sent.result?.message_id?.toString() }).where(eq(reports.id, reportId));
  } catch {
    await db.update(reports).set({ status: 'failed' }).where(eq(reports.id, reportId));
  }
}
