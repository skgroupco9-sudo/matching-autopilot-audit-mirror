export const RECOVERY_IP_WINDOW_MS = 15 * 60_000;
export const RECOVERY_IP_MAX_REQUESTS = 10;
export const RECOVERY_IP_BLOCK_MS = 15 * 60_000;

export const RECOVERY_ACCOUNT_WINDOW_MS = 60 * 60_000;
export const RECOVERY_ACCOUNT_MAX_REQUESTS = 5;
export const RECOVERY_ACCOUNT_BLOCK_MS = 60 * 60_000;

export type AuthRateLimitPolicy = {
  maxRequests: number;
  windowMs: number;
  blockMs: number;
};

export type AuthRateLimitRecord = {
  failures: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
};

export type AuthRateLimitDecision = {
  blocked: boolean;
  retryAfterSeconds: number;
  next: AuthRateLimitRecord | null;
};

export const RECOVERY_IP_POLICY: AuthRateLimitPolicy = {
  maxRequests: RECOVERY_IP_MAX_REQUESTS,
  windowMs: RECOVERY_IP_WINDOW_MS,
  blockMs: RECOVERY_IP_BLOCK_MS,
};

export const RECOVERY_ACCOUNT_POLICY: AuthRateLimitPolicy = {
  maxRequests: RECOVERY_ACCOUNT_MAX_REQUESTS,
  windowMs: RECOVERY_ACCOUNT_WINDOW_MS,
  blockMs: RECOVERY_ACCOUNT_BLOCK_MS,
};

// 現在の記録と時刻から、次に保存すべき記録と遮断判定を決める純関数。
// next が null の場合は記録を更新しない（既に遮断中で加算不要）。
export function nextAuthRateLimitState(
  record: AuthRateLimitRecord | undefined,
  now: Date,
  policy: AuthRateLimitPolicy,
): AuthRateLimitDecision {
  if (record?.blockedUntil && record.blockedUntil.getTime() > now.getTime()) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((record.blockedUntil.getTime() - now.getTime()) / 1000)),
      next: null,
    };
  }
  const inWindow = Boolean(record) && now.getTime() - record!.windowStartedAt.getTime() < policy.windowMs;
  const attempts = inWindow ? record!.failures + 1 : 1;
  const windowStartedAt = inWindow ? record!.windowStartedAt : now;
  const blocked = attempts > policy.maxRequests;
  const blockedUntil = blocked ? new Date(now.getTime() + policy.blockMs) : null;
  return {
    blocked,
    retryAfterSeconds: blocked ? Math.ceil(policy.blockMs / 1000) : 0,
    next: { failures: attempts, windowStartedAt, blockedUntil },
  };
}
