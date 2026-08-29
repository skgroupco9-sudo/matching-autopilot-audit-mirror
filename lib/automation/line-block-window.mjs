export const LINE_BLOCK_MIN_DELAY_MS = 36 * 60 * 60 * 1000;
export const LINE_BLOCK_MAX_DELAY_MS = 48 * 60 * 60 * 1000;

export function planLineBlock(receivedAt) {
  const received = validDate(receivedAt, 'line_received_at_invalid');
  return {
    receivedAt: received,
    notBefore: new Date(received.getTime() + LINE_BLOCK_MIN_DELAY_MS),
    deadline: new Date(received.getTime() + LINE_BLOCK_MAX_DELAY_MS),
  };
}

export function lineBlockExecutionState(now, receivedAt) {
  const current = validDate(now, 'line_block_now_invalid');
  const plan = planLineBlock(receivedAt);
  if (current.getTime() < plan.notBefore.getTime()) return { state: 'too_early', ...plan };
  if (current.getTime() > plan.deadline.getTime()) return { state: 'expired', ...plan };
  return { state: 'allowed', ...plan };
}

function validDate(value, errorCode) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(errorCode);
  return date;
}
