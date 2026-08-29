import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { flattenTelegramText } from '../lib/telegram-import.ts';
import { redactTelegramLearningText } from '../lib/telegram-learning-text.ts';

const inputPath = process.argv[2];
const outputDirectory = process.argv[3];
const maximumBatches = Math.max(1, Math.min(10, Number(process.argv[4] ?? 4)));
if (!inputPath || !outputDirectory) throw new Error('usage: extract-telegram-conversations <result.json> <output-directory> [maximum-batches]');

const payload = JSON.parse(await readFile(inputPath, 'utf8'));
const chats = Array.isArray(payload?.messages)
  ? [payload]
  : Array.isArray(payload?.chats?.list)
    ? payload.chats.list.filter((chat) => Array.isArray(chat?.messages))
    : [];
if (!chats.length) throw new Error('telegram_messages_not_found');

let exportEntries = 0;
let validTextMessages = 0;
const candidates = [];
for (const [chatIndex, chat] of chats.entries()) {
  for (const [messageIndex, message] of chat.messages.entries()) {
    exportEntries += 1;
    if (!message || typeof message !== 'object' || message.type !== 'message') continue;
    const raw = flattenTelegramText(message.text ?? message.text_entities).normalize('NFKC').trim();
    if (raw.length < 4) continue;
    validTextMessages += 1;
    const score = conversationScore(raw);
    if (score < 6) continue;
    const redacted = sanitizeConversation(raw);
    if (redacted.length < 4 || unsafeResidual(redacted)) continue;
    candidates.push({
      id: `${chatIndex + 1}-${String(message.id ?? messageIndex + 1)}`,
      text: redacted,
      score,
    });
  }
}

const unique = [...new Map(
  candidates
    .sort((left, right) => right.score - left.score)
    .map((candidate) => [candidate.text.replace(/\s+/gu, ' ').toLocaleLowerCase('ja-JP'), candidate]),
).values()].slice(0, maximumBatches * 500);

await mkdir(outputDirectory, { recursive: true });
const files = [];
for (let offset = 0; offset < unique.length; offset += 500) {
  const batch = unique.slice(offset, offset + 500);
  const filePath = path.join(outputDirectory, `matchpilot-conversation-batch-${String(files.length + 1).padStart(3, '0')}.json`);
  await writeFile(filePath, JSON.stringify({
    name: 'anonymized-conversation-learning',
    id: `conversation-learning-${files.length + 1}`,
    messages: batch.map((item, index) => ({ id: `${item.id}-${index}`, type: 'message', text: item.text })),
  }), 'utf8');
  files.push(filePath);
}

process.stdout.write(JSON.stringify({
  exportEntries,
  validTextMessages,
  qualifiedConversationCandidates: unique.length,
  batches: files.length,
  files,
}));

function conversationScore(value) {
  if (value.length > 600) return -100;
  const administrative = /(統括|アプリ名|相手のLINE|相手の年収|実家住所|再提出|提出|削除|NG|業務|報告|資料|件数|グループ|アカウント名|運営|対応お願いします|確認お願いします)/iu;
  if (administrative.test(value)) return -100;
  let score = value.length >= 8 && value.length <= 220 ? 2 : 0;
  if (/[？?]/u.test(value) || /(?:ですか|ますか|でしょうか|どうです|どんな|何を|いつ|どこ|どちら)/u.test(value)) score += 4;
  if (/(?:おはよう|こんにちは|こんばんは|ありがとう|嬉しい|そうなんですね|いいですね|わかります|楽しそう|よろしく)/u.test(value)) score += 3;
  if (/(?:婚活|結婚|将来|価値観|真剣|お付き合い|仕事|職業|休日|趣味|食事|旅行|映画|家族|LINE|ライン)/iu.test(value)) score += 3;
  if (/(?:ですね|ですよ|ますね|ました|だね|かな|かも)[！!。…]?$/u.test(value)) score += 2;
  if ((value.match(/[。！？!?]/gu) ?? []).length >= 2) score += 1;
  return score;
}

function sanitizeConversation(value) {
  return redactTelegramLearningText(value)
    .replace(/([一-龠々]{2,5})(さん|ちゃん|くん|君|様)/gu, '[氏名]$2')
    .replace(/\b[A-Za-z0-9._-]{3,}\b/gu, '[識別子]')
    .replace(/\d+/gu, '[数値]')
    .replace(/[ \t]+/gu, ' ')
    .trim()
    .slice(0, 700);
}

function unsafeResidual(value) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)
    || /(?:\+?81[- ]?|0)\d{1,4}[- ]?\d{1,4}[- ]?\d{3,4}/u.test(value)
    || /https?:\/\/\S+/iu.test(value)
    || /@[A-Za-z0-9_]{3,32}/u.test(value)
    || /(?:LINE|ライン)\s*(?:の\s*)?(?:ID)?\s*[:：=]\s*(?!\[)[A-Za-z0-9._-]{3,40}/iu.test(value);
}
