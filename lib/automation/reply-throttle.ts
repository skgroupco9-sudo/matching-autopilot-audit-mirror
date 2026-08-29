export const MINIMUM_REPLY_INTERVAL_MS = 2 * 60_000;
export const DAILY_OUTGOING_LIMIT_PER_CONVERSATION = 30;

export type AutomatedReplyPlan =
  | { action: 'queue'; runAfter: Date }
  | { action: 'hold'; runAfter: Date; reason: 'pending_reply_exists' | 'daily_reply_limit_reached' };

export function planAutomatedReply({
  now,
  latestOutgoingAt,
  outgoingCountToday,
  hasQueuedOutgoing,
}: {
  now: Date;
  latestOutgoingAt?: Date | null;
  outgoingCountToday: number;
  hasQueuedOutgoing: boolean;
}): AutomatedReplyPlan {
  if (hasQueuedOutgoing) {
    return { action: 'hold', runAfter: now, reason: 'pending_reply_exists' };
  }
  if (outgoingCountToday >= DAILY_OUTGOING_LIMIT_PER_CONVERSATION) {
    return { action: 'hold', runAfter: now, reason: 'daily_reply_limit_reached' };
  }

  const earliestReplyAt = latestOutgoingAt
    ? new Date(latestOutgoingAt.getTime() + MINIMUM_REPLY_INTERVAL_MS)
    : now;
  return {
    action: 'queue',
    runAfter: earliestReplyAt.getTime() > now.getTime() ? earliestReplyAt : now,
  };
}

export function replyHoldReason(reason: Extract<AutomatedReplyPlan, { action: 'hold' }>['reason']) {
  return reason === 'pending_reply_exists'
    ? '送信待ちの返信があるため、連投を停止しました'
    : 'この会話の1日あたりの自動返信上限に達しました';
}
