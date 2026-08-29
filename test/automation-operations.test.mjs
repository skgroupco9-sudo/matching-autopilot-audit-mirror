import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_OUTGOING_LIMIT_PER_CONVERSATION,
  MINIMUM_REPLY_INTERVAL_MS,
  planAutomatedReply,
  replyHoldReason,
} from '../lib/automation/reply-throttle.ts';
import {
  SCREENSHOT_RETENTION_DAYS,
  screenshotPrefixForUser,
  screenshotRetentionCutoff,
} from '../lib/screenshot-retention-policy.ts';
import { AUTOMATIC_BACKUP_RETENTION_COUNT, backupPrefixForUser, japanDateKey } from '../lib/backup-policy.ts';
import { AUTH_CHALLENGE_MAX_ATTEMPTS, AUTH_CHALLENGE_TTL_MS, isAuthCode } from '../lib/auth-challenge-policy.ts';
import { LINE_BLOCK_MAX_DELAY_MS, LINE_BLOCK_MIN_DELAY_MS, lineBlockExecutionState, planLineBlock } from '../lib/automation/line-block-window.mjs';
import {
  EXTERNAL_ACTION_JOB_TYPES,
  hasRecentDuplicateOutgoingMessage,
  isExternalActionJob,
  normalizeOutgoingMessageForSafety,
  REPEATED_OUTGOING_WINDOW_MS,
} from '../lib/automation/account-safety.ts';
import { evaluateOperationsSelfTest } from '../lib/operations-self-test.ts';
import {
  fixedOperationalSafeguards,
  MINIMUM_MESSAGES_BEFORE_HUMAN_CONTACT_REVIEW,
  prohibitedEvasionMethods,
  SAFE_ACTIVE_CONVERSATION_LIMIT_PER_PROVIDER,
  SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER,
} from '../lib/automation/operational-safety.ts';

test('正規運用ガードは保守的な上限と回避禁止を固定する', () => {
  assert.equal(SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER, 3);
  assert.equal(SAFE_ACTIVE_CONVERSATION_LIMIT_PER_PROVIDER, 10);
  assert.equal(MINIMUM_MESSAGES_BEFORE_HUMAN_CONTACT_REVIEW, 5);
  assert.equal(fixedOperationalSafeguards.some((guard) => guard.id === 'single_account'), true);
  assert.equal(fixedOperationalSafeguards.some((guard) => guard.id === 'restriction_stop'), true);
  assert.equal(prohibitedEvasionMethods.some((method) => method.includes('顔認証')), true);
});

test('初回の自動返信はすぐ送信待ちにする', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');
  const plan = planAutomatedReply({ now, latestOutgoingAt: null, outgoingCountToday: 0, hasQueuedOutgoing: false });
  assert.deepEqual(plan, { action: 'queue', runAfter: now });
});

test('直前の返信から2分空けて連投を防ぐ', () => {
  const now = new Date('2026-08-26T10:01:00.000Z');
  const previous = new Date(now.getTime() - 60_000);
  const plan = planAutomatedReply({ now, latestOutgoingAt: previous, outgoingCountToday: 1, hasQueuedOutgoing: false });
  assert.equal(plan.action, 'queue');
  assert.equal(plan.runAfter.getTime(), previous.getTime() + MINIMUM_REPLY_INTERVAL_MS);
});

test('送信待ちがある会話では返信を重ねない', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');
  const plan = planAutomatedReply({ now, latestOutgoingAt: now, outgoingCountToday: 1, hasQueuedOutgoing: true });
  assert.equal(plan.action, 'hold');
  assert.equal(plan.reason, 'pending_reply_exists');
  assert.match(replyHoldReason(plan.reason), /連投を停止/);
});

test('会話ごとの1日上限に達したら自動送信を止める', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');
  const plan = planAutomatedReply({
    now,
    latestOutgoingAt: new Date(now.getTime() - MINIMUM_REPLY_INTERVAL_MS),
    outgoingCountToday: DAILY_OUTGOING_LIMIT_PER_CONVERSATION,
    hasQueuedOutgoing: false,
  });
  assert.equal(plan.action, 'hold');
  assert.equal(plan.reason, 'daily_reply_limit_reached');
});

test('スクリーンショットの保持期限は30日', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  assert.equal(SCREENSHOT_RETENTION_DAYS, 30);
  assert.equal(screenshotRetentionCutoff(now).toISOString(), '2026-07-27T00:00:00.000Z');
});

test('スクリーンショット保存先は利用者ごとに安全な接頭辞へ分離する', () => {
  assert.equal(screenshotPrefixForUser('user/unsafe@example.com'), 'screenshots/user_unsafe_example_com/');
});

test('暗号化バックアップは利用者ごとに分離し直近7回を保持する', () => {
  assert.equal(AUTOMATIC_BACKUP_RETENTION_COUNT, 7);
  assert.equal(backupPrefixForUser('user/unsafe@example.com'), 'backups/user_unsafe_example_com/');
  assert.equal(japanDateKey(new Date('2026-08-26T15:30:00.000Z')), '2026-08-27');
});

test('Telegram認証コードは6桁・10分・最大5回に制限する', () => {
  assert.equal(isAuthCode('123456'), true);
  assert.equal(isAuthCode('12345'), false);
  assert.equal(isAuthCode('12A456'), false);
  assert.equal(AUTH_CHALLENGE_TTL_MS, 10 * 60_000);
  assert.equal(AUTH_CHALLENGE_MAX_ATTEMPTS, 5);
});

test('LINE受領後のブロックは36〜48時間の範囲だけ許可する', () => {
  const receivedAt = new Date('2026-08-28T00:00:00.000Z');
  const plan = planLineBlock(receivedAt);
  assert.equal(LINE_BLOCK_MIN_DELAY_MS, 36 * 60 * 60 * 1000);
  assert.equal(LINE_BLOCK_MAX_DELAY_MS, 48 * 60 * 60 * 1000);
  assert.equal(plan.notBefore.toISOString(), '2026-08-29T12:00:00.000Z');
  assert.equal(plan.deadline.toISOString(), '2026-08-30T00:00:00.000Z');
  assert.equal(lineBlockExecutionState(new Date('2026-08-29T11:59:59.999Z'), receivedAt).state, 'too_early');
  assert.equal(lineBlockExecutionState(new Date('2026-08-29T12:00:00.000Z'), receivedAt).state, 'allowed');
  assert.equal(lineBlockExecutionState(new Date('2026-08-30T00:00:00.000Z'), receivedAt).state, 'allowed');
  assert.equal(lineBlockExecutionState(new Date('2026-08-30T00:00:00.001Z'), receivedAt).state, 'expired');
});

test('別の相手への同一文面は表記ゆれを正規化して24時間保留にできる', () => {
  assert.equal(REPEATED_OUTGOING_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.equal(normalizeOutgoingMessageForSafety('  ＨＥＬＬＯ\n世界  '), 'hello 世界');
  assert.equal(hasRecentDuplicateOutgoingMessage('よろしく お願いします', ['別の文', 'よろしく　お願いします']), true);
  assert.equal(hasRecentDuplicateOutgoingMessage('新しい文面', ['別の文']), false);
});

test('外部操作の最終失敗だけを接続停止対象として分類する', () => {
  assert.deepEqual(EXTERNAL_ACTION_JOB_TYPES, ['like_contact', 'send_message', 'send_approved_reply', 'block_contact']);
  assert.equal(isExternalActionJob('send_message'), true);
  assert.equal(isExternalActionJob('generate_reply'), false);
  assert.equal(isExternalActionJob('start_session'), false);
});

test('安全診断は内部必須項目と実地確認を分離する', () => {
  const result = evaluateOperationsSelfTest([
    { id: 'database', ok: true, required: true },
    { id: 'storage', ok: true, required: true },
    { id: 'service', ok: false, required: false },
    { id: 'telegram', ok: true, required: false },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.operationalReady, false);
  assert.deepEqual(result.failedRequiredIds, []);

  const failed = evaluateOperationsSelfTest([
    { id: 'database', ok: false, required: true },
    { id: 'service', ok: true, required: false },
  ]);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.failedRequiredIds, ['database']);
});
