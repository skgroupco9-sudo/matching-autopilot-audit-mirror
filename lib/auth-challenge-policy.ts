export const AUTH_CHALLENGE_TTL_MS = 10 * 60_000;
export const AUTH_CHALLENGE_RESEND_COOLDOWN_MS = 60_000;
export const AUTH_CHALLENGE_MAX_ATTEMPTS = 5;

export function isAuthCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

// 試行回数の加算をデータベース側で行う単一SQL。
// 読み取り後に attempts + 1 を書き戻す実装では、同一チャレンジへの並行要求が
// すべて同じ値を読んで同じ値を書くため、上限5回を超える総当たりが可能だった
// （Codexレビューが lib/auth-rate-limit.ts で指摘したのと同一の構造）。
// 引数: ?1 チャレンジID / ?2 種別 / ?3 現在時刻ms / ?4 上限回数
export const CLAIM_AUTH_CHALLENGE_ATTEMPT_SQL = `UPDATE auth_challenges
SET attempts = attempts + 1
WHERE id = ?1
  AND kind = ?2
  AND consumed_at IS NULL
  AND expires_at > ?3
  AND attempts < ?4
RETURNING user_id, code_hash, attempts`;
