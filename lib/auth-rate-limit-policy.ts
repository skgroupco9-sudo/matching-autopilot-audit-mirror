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

// 加算をデータベース側で行う単一SQL。読み取りと書き込みを分けると、
// 同一キーへの並行要求が同じ値を読んで同じ値を書き戻し、大量の試行が
// 1件としか数えられない（Codexレビュー PR #2 / #5 の P1 指摘）。
// 引数: ?1 キー / ?2 現在時刻ms / ?3 ウィンドウ幅ms / ?4 上限回数 / ?5 遮断時間ms
export const AUTH_RATE_LIMIT_SQL = `INSERT INTO auth_rate_limits (key_hash, failures, window_started_at, blocked_until, updated_at)
VALUES (?1, 1, ?2, NULL, ?2)
ON CONFLICT(key_hash) DO UPDATE SET
  failures = CASE
    WHEN auth_rate_limits.blocked_until IS NOT NULL AND auth_rate_limits.blocked_until > ?2 THEN auth_rate_limits.failures
    WHEN ?2 - auth_rate_limits.window_started_at < ?3 THEN auth_rate_limits.failures + 1
    ELSE 1
  END,
  window_started_at = CASE
    WHEN auth_rate_limits.blocked_until IS NOT NULL AND auth_rate_limits.blocked_until > ?2 THEN auth_rate_limits.window_started_at
    WHEN ?2 - auth_rate_limits.window_started_at < ?3 THEN auth_rate_limits.window_started_at
    ELSE ?2
  END,
  blocked_until = CASE
    WHEN auth_rate_limits.blocked_until IS NOT NULL AND auth_rate_limits.blocked_until > ?2 THEN auth_rate_limits.blocked_until
    WHEN ?2 - auth_rate_limits.window_started_at < ?3 AND auth_rate_limits.failures + 1 > ?4 THEN ?2 + ?5
    ELSE NULL
  END,
  updated_at = ?2
RETURNING failures, window_started_at, blocked_until`;

export type AuthRateLimitRow = {
  failures: number;
  window_started_at: number;
  blocked_until: number | null;
};

// 単一SQLの RETURNING 値から遮断判定を導く純関数。
// 加算そのものはデータベース側で完結しているため、ここでは判定のみ行う。
export function decideFromAuthRateLimitRow(row: AuthRateLimitRow, nowMs: number): AuthRateLimitDecision {
  if (row.blocked_until !== null && row.blocked_until > nowMs) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((row.blocked_until - nowMs) / 1000)),
      next: {
        failures: row.failures,
        windowStartedAt: new Date(row.window_started_at),
        blockedUntil: new Date(row.blocked_until),
      },
    };
  }
  return {
    blocked: false,
    retryAfterSeconds: 0,
    next: { failures: row.failures, windowStartedAt: new Date(row.window_started_at), blockedUntil: null },
  };
}
