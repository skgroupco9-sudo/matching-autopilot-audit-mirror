export const REPEATED_OUTGOING_WINDOW_MS = 24 * 60 * 60 * 1000;

export const EXTERNAL_ACTION_JOB_TYPES = [
  'like_contact',
  'send_message',
  'send_approved_reply',
  'block_contact',
] as const;

export type ExternalActionJobType = (typeof EXTERNAL_ACTION_JOB_TYPES)[number];

export function normalizeOutgoingMessageForSafety(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

export function hasRecentDuplicateOutgoingMessage(draft: string, recentBodies: readonly string[]) {
  const normalizedDraft = normalizeOutgoingMessageForSafety(draft);
  if (!normalizedDraft) return false;
  return recentBodies.some((body) => normalizeOutgoingMessageForSafety(body) === normalizedDraft);
}

export function isExternalActionJob(type: string): type is ExternalActionJobType {
  return (EXTERNAL_ACTION_JOB_TYPES as readonly string[]).includes(type);
}
