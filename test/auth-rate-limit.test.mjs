import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  nextAuthRateLimitState,
  RECOVERY_ACCOUNT_POLICY,
  RECOVERY_IP_MAX_REQUESTS,
  RECOVERY_IP_POLICY,
} from '../lib/auth-rate-limit-policy.ts';

// PQA-002 回帰防止。
// パスワード再設定要求は Telegram へ確認コードを送信するため、
// IP 単位とアカウント単位の上限がないと確認コードの大量送信が可能になる。

test('上限までは通し、上限を超えた要求から遮断する', () => {
  const start = new Date('2026-08-29T00:00:00.000Z');
  let record;
  for (let attempt = 1; attempt <= RECOVERY_IP_MAX_REQUESTS; attempt += 1) {
    const decision = nextAuthRateLimitState(record, start, RECOVERY_IP_POLICY);
    assert.equal(decision.blocked, false, `${attempt} 回目は通過するべき`);
    record = decision.next;
  }
  const overLimit = nextAuthRateLimitState(record, start, RECOVERY_IP_POLICY);
  assert.equal(overLimit.blocked, true);
  assert.ok(overLimit.retryAfterSeconds > 0);
  assert.ok(overLimit.next?.blockedUntil instanceof Date);
});

test('遮断中は加算せず retry-after を返す', () => {
  const now = new Date('2026-08-29T00:00:00.000Z');
  const blocked = nextAuthRateLimitState(
    { failures: 99, windowStartedAt: now, blockedUntil: new Date(now.getTime() + 90_000) },
    now,
    RECOVERY_IP_POLICY,
  );
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.next, null);
  assert.equal(blocked.retryAfterSeconds, 90);
});

test('ウィンドウを跨いだ要求は計数をリセットする', () => {
  const start = new Date('2026-08-29T00:00:00.000Z');
  const later = new Date(start.getTime() + RECOVERY_IP_POLICY.windowMs + 1);
  const decision = nextAuthRateLimitState(
    { failures: RECOVERY_IP_MAX_REQUESTS, windowStartedAt: start, blockedUntil: null },
    later,
    RECOVERY_IP_POLICY,
  );
  assert.equal(decision.blocked, false);
  assert.equal(decision.next?.failures, 1);
  assert.equal(decision.next?.windowStartedAt.getTime(), later.getTime());
});

test('アカウント単位の上限は IP 単位より厳しく、窓は長い', () => {
  assert.ok(RECOVERY_ACCOUNT_POLICY.maxRequests < RECOVERY_IP_POLICY.maxRequests);
  assert.ok(RECOVERY_ACCOUNT_POLICY.windowMs > RECOVERY_IP_POLICY.windowMs);
});

test('パスワード再設定要求は IP とアカウントの両方を計上する', async () => {
  const source = await readFile(path.resolve('app/api/auth/recovery/request/route.ts'), 'utf8');
  assert.match(source, /consumeAuthRateLimit\(await authRateLimitKey\('recovery_ip'/);
  assert.match(source, /consumeAuthRateLimit\(await authRateLimitKey\('recovery_account'/);
  assert.match(source, /status:\s*429/);
  assert.match(source, /'retry-after'/);
  // 遮断判定はアカウント存在確認より前に行う（存在推測の材料を増やさない）。
  assert.ok(source.indexOf('recovery_account') < source.indexOf('passwordAccounts.emailNormalized'));
});

test('レート制限キーは生の IP やメールを保存しない', async () => {
  const source = await readFile(path.resolve('lib/auth-rate-limit.ts'), 'utf8');
  assert.match(source, /crypto\.subtle\.sign\('HMAC'/);
  assert.doesNotMatch(source, /keyHash:\s*subject/);
});
