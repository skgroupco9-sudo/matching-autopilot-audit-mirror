import { getDb } from '@/db';
import { telegramLearningItems } from '@/db/schema';
import { applyLearnedReportStyle } from '@/lib/telegram-learning-text';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { isSafeLearningExample } from '@/lib/telegram-learning-safety';

const requiredConversationProtocol = [
  '目的は真剣な婚活。相手本人が結婚相手を探している意思を明示するまで未確認として扱う。',
  '未確認項目は一度に一つだけ自然に尋ね、すでに会話で判明した項目は聞き直さない。',
  '外部連絡先はこちらから要求・提案せず、相手が自発的に共有した場合だけ受け取る。',
  '送信文ではLINE・ライン等の直接語も、緑のやつ等の隠語も使わず、アプリ内の会話を続ける。',
  'こちら側のLINE ID・URL・QR・電話番号・メールは送らない。',
  '婚活意思の明示確認と相手からのLINE受領が両方そろった場合だけ達成としてTelegramへ報告する。',
  'LINE受領後はアプリ内返信を終了し、受領時刻から36時間未満はブロックせず、36〜48時間内だけブロックする。即時ブロックと48時間超過は対応NG。',
].join('\n');

export async function applyTelegramReportLearning(userId: string, original: string) {
  const learned = await getDb()
    .select({ category: telegramLearningItems.category, text: telegramLearningItems.redactedText })
    .from(telegramLearningItems)
    .where(and(eq(telegramLearningItems.userId, userId), eq(telegramLearningItems.status, 'approved')))
    .orderBy(desc(telegramLearningItems.approvedAt))
    .limit(30);

  return applyLearnedReportStyle(original, learned.filter((item) => item.category !== 'unclassified' && isSafeLearningExample(item.category, item.text)));
}

export async function getTelegramConversationLearning(userId: string) {
  const learned = await getDb()
    .select({ category: telegramLearningItems.category, text: telegramLearningItems.redactedText })
    .from(telegramLearningItems)
    .where(and(
      eq(telegramLearningItems.userId, userId),
      eq(telegramLearningItems.status, 'approved'),
      inArray(telegramLearningItems.category, ['conversation_example', 'ng_rule']),
    ))
    .orderBy(desc(telegramLearningItems.approvedAt))
    .limit(12);

  return {
    examples: learned.filter((item) => item.category === 'conversation_example' && isSafeLearningExample('conversation_example', item.text)).map((item) => item.text).slice(0, 6),
    ngRules: learned.filter((item) => item.category === 'ng_rule' && isSafeLearningExample('ng_rule', item.text)).map((item) => item.text).slice(0, 12),
    profile: requiredConversationProtocol,
  };
}
