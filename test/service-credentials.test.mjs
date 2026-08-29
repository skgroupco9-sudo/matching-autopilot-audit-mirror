import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCustomServiceKey,
  maskCredentialLoginId,
  normalizeCredentialLoginId,
  normalizeServiceKey,
  normalizeServiceLabel,
  serviceCredentialLimits,
  validServicePassword,
} from '../lib/service-credentials.ts';
import { generateCompatiblePassword, generateServicePassword, getServicePasswordPolicy, isCompatibleGeneratedPassword, isServicePasswordCompatible } from '../lib/service-password-generation.ts';

test('既知サービスとカスタムサービスのキーだけを受け付ける', async () => {
  assert.equal(normalizeServiceKey(' Pairs '), 'pairs');
  assert.equal(normalizeServiceKey('not/allowed'), '');
  const customKey = await createCustomServiceKey('user_1', 'テストサービス');
  assert.match(customKey, /^custom_[0-9a-f]{32}$/);
  assert.equal(normalizeServiceKey(customKey), customKey);
});

test('サービス名とログインIDを正規化する', () => {
  assert.equal(normalizeServiceLabel('  テスト　サービス  '), 'テスト サービス');
  assert.equal(normalizeCredentialLoginId('  user@example.com  '), 'user@example.com');
  assert.equal(maskCredentialLoginId('user@example.com'), 'us•••@example.com');
});

test('サービス用パスワードを8〜128文字に制限する', () => {
  assert.equal(validServicePassword('short7'), false);
  assert.equal(validServicePassword('Valid-Password-20!'), true);
  assert.equal(validServicePassword(`bad\npassword`), false);
  assert.equal(validServicePassword('x'.repeat(serviceCredentialLimits.maximumPasswordLength + 1)), false);
});

test('サービス固有のパスワード仕様を検証する', () => {
  assert.equal(validServicePassword('1234', 'hanamel'), true);
  assert.equal(validServicePassword('12345', 'hanamel'), false);
  assert.equal(validServicePassword('Abc123', 'partners'), true);
  assert.equal(validServicePassword('Abc-123', 'partners'), false);
  assert.equal(getServicePasswordPolicy('hanamel').description, '数字4桁');
  assert.equal(isServicePasswordCompatible('partners', generateServicePassword('partners')), true);
  assert.equal(isServicePasswordCompatible('hanamel', generateServicePassword('hanamel')), true);
});

test('保管数を全サービス向けの上限に固定する', () => {
  assert.equal(serviceCredentialLimits.maximumCount, 120);
  assert.equal(serviceCredentialLimits.minimumPasswordLength, 4);
  assert.equal(serviceCredentialLimits.maximumPasswordLength, 128);
});

test('一括登録用パスワードはサービスごとに強く一意に生成する', () => {
  const passwords = Array.from({ length: 32 }, () => generateCompatiblePassword(20));
  assert.equal(new Set(passwords).size, passwords.length);
  assert.equal(passwords.every((password) => password.length === 20), true);
  assert.equal(passwords.every(isCompatibleGeneratedPassword), true);
  assert.throws(() => generateCompatiblePassword(7), /invalid_password_length/);
});
