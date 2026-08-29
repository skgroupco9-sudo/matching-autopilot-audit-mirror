import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AUTH_RATE_LIMIT_SQL,
  decideFromAuthRateLimitRow,
  nextAuthRateLimitState,
  RECOVERY_IP_POLICY,
} from '../lib/auth-rate-limit-policy.ts';

// Codexレビュー（PR #2 / #5 の P1）の回帰防止。
// 加算が読み取りと書き込みに分かれていると、同一キーへの並行要求が同じ値を読んで
// 同じ値を書き戻すため、大量の試行が1件としか数えられない。
// ここでは本番と同一のSQL文字列を SQLite 上で実行し、加算がDB側で完結することを確認する。

// node:sqlite は ?1 形式の番号付きパラメータを受け付けないため、
// 出現順に無名プレースホルダへ展開して同じ意味で実行する。
function expandNumberedParameters(sql, values) {
  const order = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_match, index) => {
    order.push(values[Number(index) - 1]);
    return '?';
  });
  return { rewritten, args: order };
}

async function createDatabase() {
  const ddl = await readFile(path.resolve('drizzle/0004_harsh_zaladane.sql'), 'utf8');
  const createTable = ddl.split('--> statement-breakpoint').find((chunk) => chunk.includes('auth_rate_limits'));
  assert.ok(createTable, 'auth_rate_limits の CREATE TABLE が見つからない');
  const db = new DatabaseSync(':memory:');
  db.exec(createTable.replaceAll('`', '"'));
  return db;
}

function consume(db, keyHash, policy, nowMs) {
  const { rewritten, args } = expandNumberedParameters(AUTH_RATE_LIMIT_SQL, [
    keyHash,
    nowMs,
    policy.windowMs,
    policy.maxRequests,
    policy.blockMs,
  ]);
  const row = db.prepare(rewritten).get(...args);
  assert.ok(row, 'RETURNING が行を返さなかった');
  return { row, decision: decideFromAuthRateLimitRow(row, nowMs) };
}

test('SQLは1文ごとに確実に1件加算する', async () => {
  const db = await createDatabase();
  const start = Date.UTC(2026, 7, 29, 0, 0, 0);
  for (let attempt = 1; attempt <= RECOVERY_IP_POLICY.maxRequests; attempt += 1) {
    const { row, decision } = consume(db, 'k', RECOVERY_IP_POLICY, start + attempt);
    assert.equal(row.failures, attempt, `${attempt}回目の計数が一致しない`);
    assert.equal(decision.blocked, false);
  }
  const over = consume(db, 'k', RECOVERY_IP_POLICY, start + RECOVERY_IP_POLICY.maxRequests + 1);
  assert.equal(over.row.failures, RECOVERY_IP_POLICY.maxRequests + 1);
  assert.equal(over.decision.blocked, true);
  assert.ok(over.decision.retryAfterSeconds > 0);
  db.close();
});

test('同一時刻の連続実行でも計数が飛ばない', async () => {
  const db = await createDatabase();
  const now = Date.UTC(2026, 7, 29, 1, 0, 0);
  // 並行要求は同じ現在時刻を持つ。読み取り後に計算する実装だとここで全件が
  // failures = 1 を書き込み、上限を回避できていた。
  const counts = [];
  for (let index = 0; index < 25; index += 1) {
    counts.push(consume(db, 'burst', RECOVERY_IP_POLICY, now).row.failures);
  }
  assert.deepEqual(counts.slice(0, RECOVERY_IP_POLICY.maxRequests + 1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  db.close();
});

test('遮断中は加算せず遮断終了時刻を保つ', async () => {
  const db = await createDatabase();
  const start = Date.UTC(2026, 7, 29, 2, 0, 0);
  for (let attempt = 0; attempt <= RECOVERY_IP_POLICY.maxRequests; attempt += 1) {
    consume(db, 'blocked', RECOVERY_IP_POLICY, start);
  }
  const first = consume(db, 'blocked', RECOVERY_IP_POLICY, start + 1_000);
  assert.equal(first.decision.blocked, true);
  const second = consume(db, 'blocked', RECOVERY_IP_POLICY, start + 2_000);
  assert.equal(second.row.failures, first.row.failures, '遮断中に加算された');
  assert.equal(second.row.blocked_until, first.row.blocked_until, '遮断終了時刻が延長された');
  assert.ok(second.decision.retryAfterSeconds < first.decision.retryAfterSeconds);
  db.close();
});

test('ウィンドウを跨ぐと計数がリセットされる', async () => {
  const db = await createDatabase();
  const start = Date.UTC(2026, 7, 29, 3, 0, 0);
  consume(db, 'window', RECOVERY_IP_POLICY, start);
  consume(db, 'window', RECOVERY_IP_POLICY, start + 1_000);
  const after = consume(db, 'window', RECOVERY_IP_POLICY, start + RECOVERY_IP_POLICY.windowMs + 1);
  assert.equal(after.row.failures, 1);
  assert.equal(after.row.window_started_at, start + RECOVERY_IP_POLICY.windowMs + 1);
  db.close();
});

test('SQLの判定は純関数 nextAuthRateLimitState と一致する', async () => {
  const db = await createDatabase();
  const start = Date.UTC(2026, 7, 29, 4, 0, 0);
  // 純関数側の状態を並走させ、同じ入力列に対して同じ結論になることを確認する。
  let expected;
  const steps = [0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000, 11_000, 12_000];
  for (const offset of steps) {
    const nowMs = start + offset;
    const pure = nextAuthRateLimitState(expected, new Date(nowMs), RECOVERY_IP_POLICY);
    const actual = consume(db, 'parity', RECOVERY_IP_POLICY, nowMs);
    assert.equal(actual.decision.blocked, pure.blocked, `offset=${offset} の遮断判定が一致しない`);
    if (pure.next) {
      assert.equal(actual.row.failures, pure.next.failures, `offset=${offset} の計数が一致しない`);
      expected = pure.next;
    }
  }
  db.close();
});

test('本番経路は単一SQLで加算し、読み取り後の計算に戻していない', async () => {
  const source = await readFile(path.resolve('lib/auth-rate-limit.ts'), 'utf8');
  const start = source.indexOf('export async function consumeAuthRateLimit');
  assert.ok(start > -1, 'consumeAuthRateLimit が見つからない');
  // 関数本体だけを対象にする。読み取り専用の isAuthRateLimited は加算経路ではない。
  const body = source.slice(start, source.indexOf('\n}', start) + 2);
  assert.match(body, /getD1\(\)\s*\n?\s*\.prepare\(AUTH_RATE_LIMIT_SQL\)/);
  assert.doesNotMatch(body, /db\.select\(/, '加算経路に読み取りが復活している');
  assert.doesNotMatch(body, /onConflictDoUpdate/, '絶対値の書き戻しが復活している');
  assert.match(AUTH_RATE_LIMIT_SQL, /auth_rate_limits\.failures \+ 1/);
  assert.match(AUTH_RATE_LIMIT_SQL, /RETURNING failures, window_started_at, blocked_until/);
});
