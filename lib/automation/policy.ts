import type { ConversationPolicy, ReplyAssessment } from './types';
import { extractContactExchange } from './contact-extraction.mjs';
import { hasProhibitedOffPlatformReference } from './outgoing-language-policy.mjs';

const schedulingPattern = /(会う|会おう|日程|予定|空いて|何時|いつ|予約|店|場所|住所)/i;
const contactPattern = /(line|ライン|telegram|テレグラム|instagram|インスタ|電話番号|連絡先|メール)/i;
const highRiskPattern = /(送金|振込|投資|暗号資産|仮想通貨|副業|宗教|勧誘|パスワード|認証コード|身分証)/i;
const ownContactOfferPattern = /(?:私|わたし|僕|自分|こちら|こっち)\s*(?:の|から)?[^\n]{0,16}(?:LINE|ライン)[^\n]{0,24}(?:ID|QR|送る|送ります|教える|教えます|追加して)/i;

export function assessReply(
  draft: string,
  confidence: number,
  policy: ConversationPolicy,
): ReplyAssessment {
  const reasons: string[] = [];

  if (policy.blockedTopics.some((topic) => draft.toLowerCase().includes(topic.toLowerCase()))) {
    return { action: 'block', reasons: ['禁止テーマを検出しました'], confidence };
  }

  if (highRiskPattern.test(draft)) {
    return { action: 'block', reasons: ['金銭・認証・勧誘に関する高リスクな内容です'], confidence };
  }

  if (hasProhibitedOffPlatformReference(draft)) {
    return { action: 'block', reasons: ['外部連絡先の直接表現・隠語・交換依頼は送信しません'], confidence };
  }

  if (
    policy.contactExchangeDirection === 'receive_only'
    && (extractContactExchange(draft).detected || ownContactOfferPattern.test(draft))
  ) {
    return { action: 'block', reasons: ['自分側のLINE・連絡先は送信しません'], confidence };
  }

  if (confidence < policy.minimumConfidence) {
    reasons.push(`確信度が基準値 ${policy.minimumConfidence}% 未満です`);
  }
  if (policy.requireApprovalForScheduling && schedulingPattern.test(draft)) {
    reasons.push('日程・場所の確定を含みます');
  }
  if (
    policy.requireApprovalForContactExchange
    && policy.contactExchangeDirection !== 'receive_only'
    && contactPattern.test(draft)
  ) {
    reasons.push('連絡先の交換を含みます');
  }
  if (policy.mode !== 'full_auto') {
    reasons.push(policy.mode === 'approval' ? '承認モードです' : '下書き専用モードです');
  }

  return {
    action: reasons.length === 0 ? 'send' : 'request_approval',
    reasons,
    confidence,
  };
}
