import { getDb } from '@/db';
import { contacts, conversations, reports, users, workerHeartbeats } from '@/db/schema';
import { sendTelegramReport } from '@/lib/telegram';
import { applyTelegramReportLearning } from '@/lib/telegram-learning';
import { purgeExpiredScreenshots } from '@/lib/screenshot-retention';
import { createEncryptedAccountBackup } from '@/lib/account-backup';
import { authorizeWorkerRequest } from '@/lib/worker-auth';
import { and, eq, gte } from 'drizzle-orm';

type SummaryBody = { userId?: string; date?: string };

export async function POST(request: Request) {
  const worker = await authorizeWorkerRequest(request);
  if (!worker) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let body: SummaryBody;
  try {
    body = (await request.json()) as SummaryBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.userId || !body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return Response.json({ error: 'invalid_summary_request' }, { status: 400 });
  }
  if (body.userId !== worker.userId) return Response.json({ error: 'worker_binding_mismatch' }, { status: 403 });

  const db = getDb();
  const freshWorker = await db
    .select({ id: workerHeartbeats.workerId })
    .from(workerHeartbeats)
    .where(and(eq(workerHeartbeats.workerId, worker.workerId), eq(workerHeartbeats.userId, worker.userId), gte(workerHeartbeats.lastSeenAt, new Date(Date.now() - 120_000))))
    .limit(1);
  if (!freshWorker[0]) return Response.json({ error: 'fresh_heartbeat_required' }, { status: 409 });

  // Retention cleanup is best-effort so report delivery is never blocked by storage maintenance.
  await purgeExpiredScreenshots(body.userId).catch(() => 0);
  await createEncryptedAccountBackup(body.userId).catch(() => null);

  const reportId = `daily_${await stableKey(`${body.userId}:${body.date}`)}`;
  const existing = await db.select({ status: reports.status }).from(reports).where(eq(reports.id, reportId)).limit(1);
  if (existing[0]?.status === 'sent') return Response.json({ ok: true, duplicate: true });

  const [recipientRows, contactRows, conversationRows] = await Promise.all([
    db.select({ telegramChatId: users.telegramChatId }).from(users).where(eq(users.id, body.userId)).limit(1),
    db.select({ status: contacts.status }).from(contacts).where(eq(contacts.userId, body.userId)),
    db.select({ status: conversations.status }).from(conversations).where(eq(conversations.userId, body.userId)),
  ]);
  const baseText = [
    `📊 ${body.date} MatchPilotサマリー`,
    '',
    `いいね済み: ${contactRows.filter((contact) => contact.status === 'liked').length}件`,
    `マッチ済み: ${contactRows.filter((contact) => contact.status === 'matched').length}件`,
    `進行中の会話: ${conversationRows.filter((conversation) => conversation.status === 'active').length}件`,
    `判断待ち: ${conversationRows.filter((conversation) => conversation.status === 'escalated').length}件`,
    `条件達成: ${conversationRows.filter((conversation) => conversation.status === 'goal_reached').length}件`,
  ].join('\n');
  const text = await applyTelegramReportLearning(body.userId, baseText);
  const now = new Date();
  await db
    .insert(reports)
    .values({ id: reportId, userId: body.userId, kind: 'daily_summary', text, status: 'pending', createdAt: now })
    .onConflictDoUpdate({ target: reports.id, set: { text, status: 'pending' } });

  const chatId = recipientRows[0]?.telegramChatId;
  if (!chatId) return Response.json({ ok: true, skipped: 'telegram_not_linked' });
  try {
    const result = await sendTelegramReport({ chatId, text });
    await db.update(reports).set({ status: 'sent', telegramMessageId: result.result?.message_id?.toString() }).where(eq(reports.id, reportId));
    return Response.json({ ok: true });
  } catch {
    await db.update(reports).set({ status: 'failed' }).where(eq(reports.id, reportId));
    return Response.json({ error: 'telegram_delivery_failed' }, { status: 502 });
  }
}

async function stableKey(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
