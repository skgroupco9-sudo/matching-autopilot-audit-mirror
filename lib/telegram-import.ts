import { redactTelegramLearningText } from './telegram-learning-text.ts';

export const telegramImportLimits = {
  maximumHistoryFileBytes: 10 * 1024 * 1024,
  maximumImageFileBytes: 3 * 1024 * 1024,
  maximumImageCount: 3,
  maximumCombinedBytes: 16 * 1024 * 1024,
  maximumMessages: 500,
  maximumPastedTextCharacters: 40_000,
  // D1 accepts a bounded number of bound parameters per statement. Each
  // learning row binds ten values, so keep multi-row inserts comfortably
  // below that limit.
  databaseInsertBatchSize: 8,
} as const;

export type TelegramImportCandidate = {
  telegramMessageId: string;
  redactedText: string;
};

export type TelegramImportParseResult = {
  candidates: TelegramImportCandidate[];
  totalMessages: number;
  skipped: number;
  truncated: number;
};

export type VisionLearningSnippet = {
  role: 'self' | 'other' | 'unknown';
  text: string;
  replyContext: string;
};

type UnknownRecord = Record<string, unknown>;

export async function parseTelegramExportJson(raw: string): Promise<TelegramImportParseResult> {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('invalid_telegram_json');
  }

  const chats = telegramChats(payload);
  if (!chats.length) throw new Error('telegram_messages_not_found');

  const all: TelegramImportCandidate[] = [];
  let totalMessages = 0;
  let skipped = 0;

  for (const [chatIndex, chat] of chats.entries()) {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const chatSeed = safeSeed(chat.id) || safeSeed(chat.name) || `chat-${chatIndex}`;
    for (const [messageIndex, value] of messages.entries()) {
      totalMessages += 1;
      if (!isRecord(value) || value.type !== 'message') {
        skipped += 1;
        continue;
      }
      const text = flattenTelegramText(value.text ?? value.text_entities);
      const redactedText = redactTelegramLearningText(text);
      if (redactedText.length < 2) {
        skipped += 1;
        continue;
      }
      const messageSeed = safeSeed(value.id) || `message-${messageIndex}`;
      all.push({
        telegramMessageId: await telegramImportMessageId(`${chatSeed}:${messageSeed}:${redactedText}`),
        redactedText,
      });
    }
  }

  return limitCandidates(all, totalMessages, skipped);
}

export async function parseSubmittedText(raw: string, source = 'pasted'): Promise<TelegramImportParseResult> {
  const normalized = raw.normalize('NFKC').trim();
  if (!normalized) return { candidates: [], totalMessages: 0, skipped: 0, truncated: 0 };
  const blocks = normalized
    .split(/\n\s*\n|(?<=\S)[\r\n]+(?=(?:[^\s:：]{1,40}\s*[:：]|[・●■▶→-]\s*))/u)
    .map((value) => redactTelegramLearningText(value))
    .filter((value) => value.length >= 2);
  const candidates = await Promise.all(blocks.map(async (redactedText, index) => ({
    telegramMessageId: await telegramImportMessageId(`${source}:${index}:${redactedText}`),
    redactedText,
  })));
  return limitCandidates(candidates, blocks.length, 0);
}

export function flattenTelegramText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenTelegramText).join('');
  if (isRecord(value)) return flattenTelegramText(value.text);
  return '';
}

export function normalizeVisionSnippets(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.snippets)) return [];
  return value.snippets
    .map((item): VisionLearningSnippet | null => {
      if (!isRecord(item) || typeof item.text !== 'string' || !['self', 'other', 'unknown'].includes(String(item.role))) return null;
      const text = redactTelegramLearningText(item.text);
      const replyContext = typeof item.replyContext === 'string' ? redactTelegramLearningText(item.replyContext).slice(0, 800) : '';
      return text.length >= 2 ? { role: item.role as VisionLearningSnippet['role'], text, replyContext } : null;
    })
    .filter((item): item is VisionLearningSnippet => Boolean(item))
    .slice(0, 30);
}

export async function telegramImportMessageId(seed: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return `import:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function telegramChats(value: unknown): UnknownRecord[] {
  if (!isRecord(value)) return [];
  if (Array.isArray(value.messages)) return [value];
  if (isRecord(value.chats) && Array.isArray(value.chats.list)) {
    return value.chats.list.filter(isRecord).filter((chat) => Array.isArray(chat.messages));
  }
  return [];
}

function limitCandidates(candidates: TelegramImportCandidate[], totalMessages: number, skipped: number) {
  const unique = Array.from(new Map(candidates.map((candidate) => [candidate.telegramMessageId, candidate])).values());
  const truncated = Math.max(0, unique.length - telegramImportLimits.maximumMessages);
  return {
    candidates: unique.slice(-telegramImportLimits.maximumMessages),
    totalMessages,
    skipped: skipped + (candidates.length - unique.length),
    truncated,
  };
}

function safeSeed(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : '';
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
