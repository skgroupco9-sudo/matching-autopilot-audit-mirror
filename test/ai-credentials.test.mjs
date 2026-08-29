import test from 'node:test';
import assert from 'node:assert/strict';
import { aiCredentialVaultContext, defaultOpenAiModel, normalizeOpenAiModel, openAiKeyHint, validOpenAiApiKey } from '../lib/ai-credentials.ts';
import { probeOpenAiConnection } from '../lib/openai-connection.ts';

test('OpenAI APIキーは秘密値として扱える安全な形式だけを受け付ける', () => {
  assert.equal(validOpenAiApiKey(`sk-${'a'.repeat(48)}`), true);
  assert.equal(validOpenAiApiKey('short'), false);
  assert.equal(validOpenAiApiKey(`sk-${'a'.repeat(20)}\n`), false);
  assert.equal(validOpenAiApiKey(`pk-${'a'.repeat(48)}`), false);
});

test('モデル名と表示用ヒントを安全な範囲へ正規化する', () => {
  assert.equal(defaultOpenAiModel, 'gpt-5.6-luna');
  assert.equal(normalizeOpenAiModel('gpt-5.6-luna'), 'gpt-5.6-luna');
  assert.equal(normalizeOpenAiModel('../secret'), defaultOpenAiModel);
  assert.equal(openAiKeyHint(`sk-${'b'.repeat(28)}1234`), '••••1234');
  assert.equal(aiCredentialVaultContext('user_1'), 'user_1:ai:openai:api_key');
});

test('OpenAI実接続診断は秘密値を返さず正常応答を判定する', async () => {
  let authorization = '';
  const probe = await probeOpenAiConnection(`sk-${'c'.repeat(48)}`, 'gpt-5.6-luna', async (_input, init) => {
    authorization = new Headers(init?.headers).get('authorization') ?? '';
    return Response.json({ id: 'resp_test' });
  });
  assert.equal(authorization.startsWith('Bearer sk-'), true);
  assert.equal(probe.ok, true);
  assert.equal(probe.code, 'ok');
  assert.equal(JSON.stringify(probe).includes('sk-'), false);
});

test('OpenAI実接続診断は請求・権限・モデルエラーを安全な分類へ変換する', async () => {
  const quota = await probeOpenAiConnection('sk-test', 'gpt-test', async () => Response.json({ error: { code: 'insufficient_quota', message: 'secret provider detail' } }, { status: 429 }));
  assert.equal(quota.code, 'insufficient_quota');
  assert.equal(JSON.stringify(quota).includes('secret provider detail'), false);

  const auth = await probeOpenAiConnection('sk-test', 'gpt-test', async () => Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 }));
  assert.equal(auth.code, 'invalid_api_key');

  const model = await probeOpenAiConnection('sk-test', 'gpt-test', async () => Response.json({ error: { code: 'model_not_found' } }, { status: 404 }));
  assert.equal(model.code, 'model_unavailable');
});
