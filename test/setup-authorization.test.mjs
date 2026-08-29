import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// PQA-003 回帰防止。
// MATCHPILOT_ADMIN_EMAIL は「誰が管理者になれるか」の制約であり、
// 初回登録の認可材料にしてはならない。認可は MATCHPILOT_SETUP_SECRET の所持
// （トークン直接指定、またはセットアップ Cookie）のみで判定する。

test('初回登録はセットアップトークンまたはセットアップCookieを必須にする', async () => {
  const source = await readFile(path.resolve('app/api/auth/register/route.ts'), 'utf8');
  const line = source.split('\n').find((value) => value.includes('const setupAuthorized'));
  assert.ok(line, 'setupAuthorized の判定行が見つからない');
  assert.doesNotMatch(line, /Boolean\(adminEmail\)/, '管理者メールの設定だけで認可してはならない');
  assert.match(line, /verifySetupToken\(setupToken\)/);
  assert.match(line, /await hasSetupAccess\(\)/);
  assert.match(source, /invalid_setup_token/);
});

test('管理者メールの一致確認は認可とは別に維持する', async () => {
  const source = await readFile(path.resolve('app/api/auth/register/route.ts'), 'utf8');
  assert.match(source, /adminEmail && email !== adminEmail/);
  assert.match(source, /admin_email_required/);
});

test('未認証の状態確認APIは管理者メールの設定有無で認可済みを名乗らない', async () => {
  const source = await readFile(path.resolve('app/api/auth/status/route.ts'), 'utf8');
  const line = source.split('\n').find((value) => value.includes('setupAuthorized'));
  assert.ok(line, 'setupAuthorized の応答行が見つからない');
  assert.doesNotMatch(line, /configuredAdminEmail\(\)/);
  assert.match(line, /await hasSetupAccess\(\)/);
});

test('セットアップ設定はセットアップ秘密とセッション秘密の両方を要求する', async () => {
  const source = await readFile(path.resolve('app/personal-auth.ts'), 'utf8');
  assert.match(source, /export function isSetupConfigured\(\)[\s\S]{0,160}MATCHPILOT_SETUP_SECRET/);
  assert.match(source, /export function isSetupConfigured\(\)[\s\S]{0,160}MATCHPILOT_SESSION_SECRET/);
});

test('初回登録の既存アカウント確認は招待必須へ倒す', async () => {
  const source = await readFile(path.resolve('app/api/auth/register/route.ts'), 'utf8');
  assert.match(source, /invite_required/);
  assert.ok(source.indexOf('invite_required') < source.indexOf('const setupAuthorized'));
});
