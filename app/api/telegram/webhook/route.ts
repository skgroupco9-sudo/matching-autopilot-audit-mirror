import { getD1, getDb } from '@/db';
import { telegramLearningItems, telegramLinkTokens, users } from '@/db/schema';
import { answerTelegramCallback, sendTelegramReport } from '@/lib/telegram';
import { learningPreview, redactTelegramLearningText } from '@/lib/telegram-learning-text';
import { secretsEqual } from '@/lib/worker-auth';
import { env } from 'cloudflare:workers';
import { and, eq, gt } from 'drizzle-orm';

type TelegramUpdate = {
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    chat?: { id?: number };
    forward_origin?: unknown;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id?: number } };
  };
};

export async function POST(request: Request) {
  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;
  const actualSecret = request.headers.get('x-telegram-bot-api-secret-token');
  if (!expectedSecret || !actualSecret || !secretsEqual(actualSecret, expectedSecret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const startToken = update.message?.text?.match(/^\/start\s+([A-Za-z0-9_-]{20,80})$/)?.[1];
  const chatId = update.message?.chat?.id;
  if (startToken && typeof chatId === 'number') {
    const tokenHash = await sha256(startToken);
    const db = getDb();
    const tokenRows = await db
      .select({ userId: telegramLinkTokens.userId })
      .from(telegramLinkTokens)
      .where(and(eq(telegramLinkTokens.tokenHash, tokenHash), gt(telegramLinkTokens.expiresAt, new Date())))
      .limit(1);
    if (!tokenRows[0]) {
      await sendTelegramReport({ chatId: String(chatId), text: 'この接続リンクは無効か期限切れです。MatchPilotから新しいリンクを発行してください。' });
      return Response.json({ ok: true });
    }
    const linkedAt = new Date();
    await db.batch([
      db.update(users).set({ telegramChatId: null, updatedAt: linkedAt }).where(eq(users.telegramChatId, String(chatId))),
      db.update(users).set({ telegramChatId: String(chatId), updatedAt: linkedAt }).where(eq(users.id, tokenRows[0].userId)),
    ]);
    await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.tokenHash, tokenHash));
    await sendTelegramReport({ chatId: String(chatId), text: '✅ MatchPilotと接続しました。判断が必要な会話や条件達成をここへ報告します。' });
    return Response.json({ ok: true, linked: true });
  }

  if (typeof chatId === 'number' && typeof update.message?.message_id === 'number') {
    const incomingText = update.message.text ?? update.message.caption ?? '';
    const linkedUser = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramChatId, String(chatId)))
      .limit(1);
    if (linkedUser[0]) {
      if (/^\/(help|learning|start)(?:@\w+)?\s*$/i.test(incomingText)) {
        await sendTelegramReport({
          chatId: String(chatId),
          text: '🧠 報告・会話学習\n\n他のグループで参考にしたいメッセージを長押しして、このBotへ転送してください。「報告例」「会話例」「NG」を選び、最後に承認した内容だけを反映します。Botがグループ履歴を勝手に読むことはありません。個人情報を伏せ、画像・動画本体や転送元の氏名は保存しません。',
        });
        return Response.json({ ok: true });
      }
      if (incomingText.trim() && !incomingText.trim().startsWith('/')) {
        const redactedText = redactTelegramLearningText(incomingText);
        if (!redactedText) return Response.json({ ok: true });
        const now = new Date();
        const learningId = `learning_${crypto.randomUUID()}`;
        await getDb().insert(telegramLearningItems).values({
          id: learningId,
          userId: linkedUser[0].id,
          telegramMessageId: String(update.message.message_id),
          sourceKind: update.message.forward_origin ? 'forwarded' : 'direct',
          category: 'unclassified',
          status: 'pending',
          redactedText,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();
        const stored = await getDb()
          .select({ id: telegramLearningItems.id, text: telegramLearningItems.redactedText })
          .from(telegramLearningItems)
          .where(and(eq(telegramLearningItems.userId, linkedUser[0].id), eq(telegramLearningItems.telegramMessageId, String(update.message.message_id))))
          .limit(1);
        if (stored[0]) {
          await sendTelegramReport({
            chatId: String(chatId),
            text: `個人情報を伏せて下書きにしました。\n\n${learningPreview(stored[0].text)}\n\nどちらとして覚えますか？`,
            buttons: [
              { text: '報告例', callbackData: `learn_good:${stored[0].id}` },
              { text: '会話例', callbackData: `learn_conversation:${stored[0].id}` },
              { text: 'NG', callbackData: `learn_ng:${stored[0].id}` },
              { text: '保存しない', callbackData: `learn_skip:${stored[0].id}` },
            ],
          });
        }
        return Response.json({ ok: true, learningDraft: true });
      }
    }
  }

  const callback = update.callback_query;
  if (!callback?.data) return Response.json({ ok: true });

  const [action, jobId] = callback.data.split(':');
  const callbackChatId = callback.message?.chat?.id;
  if (jobId && ['learn_good', 'learn_conversation', 'learn_ng', 'learn_skip', 'learn_apply'].includes(action) && typeof callbackChatId === 'number') {
    const owner = await getDb().select({ id: users.id }).from(users).where(eq(users.telegramChatId, String(callbackChatId))).limit(1);
    if (!owner[0]) {
      await answerTelegramCallback(callback.id, 'このTelegramはMatchPilotへ接続されていません');
      return Response.json({ ok: true });
    }
    const ownedItem = and(eq(telegramLearningItems.id, jobId), eq(telegramLearningItems.userId, owner[0].id));
    const now = new Date();
    if (action === 'learn_skip') {
      const updated = await getDb().update(telegramLearningItems).set({ status: 'rejected', updatedAt: now }).where(ownedItem).returning({ id: telegramLearningItems.id });
      await answerTelegramCallback(callback.id, updated[0] ? '保存対象から外しました' : '対象が見つかりません');
      return Response.json({ ok: true });
    }
    if (action === 'learn_apply') {
      const updated = await getDb().update(telegramLearningItems).set({ status: 'approved', approvedAt: now, updatedAt: now }).where(and(ownedItem, eq(telegramLearningItems.status, 'ready'))).returning({ id: telegramLearningItems.id, category: telegramLearningItems.category });
      const destination = updated[0]?.category === 'conversation_example' ? 'AI会話' : updated[0]?.category === 'ng_rule' ? '報告とAI会話' : 'Telegram報告';
      await answerTelegramCallback(callback.id, updated[0] ? `${destination}へ反映しました` : 'すでに処理済みです');
      if (updated[0]) {
        await sendTelegramReport({ chatId: String(callbackChatId), text: `✅ 学習済みです。次回以降の${destination}から反映します。` });
      }
      return Response.json({ ok: true });
    }
    const category = action === 'learn_good' ? 'report_example' : action === 'learn_conversation' ? 'conversation_example' : 'ng_rule';
    const updated = await getDb().update(telegramLearningItems).set({ category, status: 'ready', updatedAt: now }).where(ownedItem).returning({ id: telegramLearningItems.id, text: telegramLearningItems.redactedText });
    const categoryLabel = category === 'report_example' ? '報告例' : category === 'conversation_example' ? '会話例' : 'NG';
    await answerTelegramCallback(callback.id, updated[0] ? `${categoryLabel}に分類しました` : '対象が見つかりません');
    if (updated[0]) {
      await sendTelegramReport({
        chatId: String(callbackChatId),
        text: `${categoryLabel}として反映しますか？\n\n${learningPreview(updated[0].text)}`,
        buttons: [
          { text: '反映する', callbackData: `learn_apply:${updated[0].id}` },
          { text: '取り消す', callbackData: `learn_skip:${updated[0].id}` },
        ],
      });
    }
    return Response.json({ ok: true });
  }
  if (!jobId || !['approve', 'cancel'].includes(action) || typeof callbackChatId !== 'number') {
    await answerTelegramCallback(callback.id, '操作を認識できませんでした');
    return Response.json({ ok: true });
  }

  const now = Date.now();
  const nextStatus = action === 'approve' ? 'pending' : 'cancelled';
  const nextType = action === 'approve' ? 'send_approved_reply' : null;
  const result = await getD1()
    .prepare(
      `UPDATE automation_jobs
       SET status = ?, type = COALESCE(?, type), run_after = ?, updated_at = ?
       WHERE id = ? AND status = 'awaiting_approval'
         AND user_id IN (SELECT id FROM users WHERE telegram_chat_id = ?)
       RETURNING id`,
    )
    .bind(nextStatus, nextType, now, now, jobId, String(callbackChatId))
    .first<{ id: string }>();

  await answerTelegramCallback(
    callback.id,
    result
      ? action === 'approve'
        ? '送信を承認しました'
        : '送信を取り消しました'
      : 'この操作はこのアカウントでは実行できないか、すでに処理済みです',
  );

  return Response.json({ ok: true });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
