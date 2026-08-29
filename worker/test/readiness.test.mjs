import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerReadiness, effectiveHeartbeatStatus } from '../src/readiness.mjs';

test('AIキーがないワーカーは返信生成を申告せずdegradedになる', () => {
  const readiness = buildWorkerReadiness({ openaiApiKey: '' });
  assert.equal(readiness.degraded, true);
  assert.deepEqual(readiness.missing, ['OPENAI_API_KEY']);
  assert.equal(readiness.capabilities.includes('reply_generation'), false);
  assert.equal(readiness.capabilities.includes('registration_credential_prefill'), true);
  assert.equal(readiness.capabilities.includes('line_contact_detection'), true);
  assert.equal(readiness.capabilities.includes('delayed_line_block'), true);
  assert.equal(readiness.capabilities.includes('account_freeze_guard'), true);
  assert.equal(readiness.capabilities.includes('unique_reply_generation'), true);
  assert.equal(effectiveHeartbeatStatus('online', readiness), 'degraded');
});

test('AIキーがあるワーカーだけ返信生成能力を申告する', () => {
  const readiness = buildWorkerReadiness({ openaiApiKey: 'test-key' });
  assert.equal(readiness.degraded, false);
  assert.equal(readiness.capabilities.includes('reply_generation'), true);
  assert.equal(effectiveHeartbeatStatus('busy', readiness), 'busy');
});

test('停止heartbeatは不足設定より優先される', () => {
  const readiness = buildWorkerReadiness({ openaiApiKey: '' });
  assert.equal(effectiveHeartbeatStatus('offline', readiness), 'offline');
});
