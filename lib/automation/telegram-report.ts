import type { WorkerEvent } from './types';
import { extractContactExchange } from './contact-extraction.mjs';

type ContactExchangePayload = {
  detected?: unknown;
  lineId?: unknown;
  lineUrl?: unknown;
  qrMentioned?: unknown;
};

export function enrichIncomingContactEvent(event: WorkerEvent): WorkerEvent {
  if (event.type !== 'incoming_message') return event;
  const contactExchange = extractContactExchange(stringField(event.payload.body) ?? '');
  if (!contactExchange.detected) return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      contactExchange,
    },
  };
}

export function formatAutomationReport(event: WorkerEvent): string {
  const contactExchange = objectField(event.payload.contactExchange) as ContactExchangePayload;
  const lineId = lineIdField(contactExchange.lineId);
  const lineUrl = lineUrlField(contactExchange.lineUrl);
  const qrMentioned = contactExchange.qrMentioned === true;
  const lineReceived = contactExchange.detected === true || Boolean(lineId || lineUrl || qrMentioned);
  const title = event.type === 'block_completed'
    ? '✅ 予定時間内にブロックしました'
    : event.type === 'block_failed'
      ? '⚠️ ブロック対応が完了していません'
      : lineReceived
    ? '✅ LINEを受領しました'
    : event.type === 'goal_reached'
      ? '✅ 条件を達成しました'
      : '⏸ 確認が必要です';
  const person = stringField(event.payload.displayName) ?? 'マッチ相手';
  const provider = stringField(event.payload.provider) ?? 'マッチングアプリ';
  const summary = stringField(event.payload.summary);
  const goalReason = stringField(event.payload.goalReason);
  const suggestedReply = stringField(event.payload.suggestedReply);
  const profileUrl = safeHttpUrl(event.payload.profileUrl);
  const threadUrl = safeHttpUrl(event.payload.threadUrl);
  const receivedBody = lineReceived ? oneLine(stringField(event.payload.body), 320) : undefined;
  const hasScreenshot = Boolean(stringField(event.payload.screenshotObjectKey));
  const blockNotBefore = japaneseDateTime(event.payload.blockNotBefore);
  const blockDeadline = japaneseDateTime(event.payload.blockDeadline);

  return [
    title,
    '',
    `【相手】${person}`,
    `【アプリ】${provider}`,
    lineId ? `【LINE ID】${lineId}` : undefined,
    lineUrl ? `【LINE URL】${lineUrl}` : undefined,
    qrMentioned ? '【LINE QR】会話画面で受領' : undefined,
    goalReason ? `【判定】${goalReason}` : undefined,
    summary ? `【会話要約】${oneLine(summary, 300)}` : undefined,
    receivedBody ? `【受信文】${receivedBody}` : undefined,
    suggestedReply ? `【返信案】${oneLine(suggestedReply, 500)}` : undefined,
    profileUrl ? `【相手ページ】${profileUrl}` : undefined,
    threadUrl ? `【会話画面】${threadUrl}` : undefined,
    hasScreenshot ? '【添付】会話スクリーンショット' : undefined,
    blockNotBefore ? `【ブロック開始】${blockNotBefore}` : undefined,
    blockDeadline ? `【ブロック期限】${blockDeadline}` : undefined,
  ].filter(Boolean).join('\n');
}

function japaneseDateTime(value: unknown) {
  const text = stringField(value);
  if (!text) return undefined;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 4000) : undefined;
}

function lineIdField(value: unknown) {
  const text = stringField(value);
  return text && /^@[a-z0-9][a-z0-9._-]{2,39}$/i.test(text) ? text.toLowerCase() : undefined;
}

function lineUrlField(value: unknown) {
  const text = safeHttpUrl(value);
  if (!text) return undefined;
  try {
    return ['line.me', 'www.line.me', 'lin.ee', 'www.lin.ee'].includes(new URL(text).hostname.toLowerCase()) ? text : undefined;
  } catch {
    return undefined;
  }
}

function safeHttpUrl(value: unknown) {
  const text = stringField(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function oneLine(value: string | undefined, maximum: number) {
  return value?.replace(/\s+/gu, ' ').trim().slice(0, maximum) || undefined;
}
