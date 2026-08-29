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
  const block = source.slice(source.indexOf('const decision = decideInitialSetupAuthorization'), source.indexOf('const now = Date.now()'));
  assert.ok(block, '認可判定のブロックが見つからない');
  assert.doesNotMatch(block, /Boolean\(adminEmail\)/, '管理者メールの設定だけで認可してはならない');
  assert.match(block, /setupTokenValid: verifySetupToken\(setupToken\)/);
  assert.match(block, /setupCookieValid: await hasSetupAccess\(\)/);
  assert.match(block, /invalid_setup_token/);
});

test('管理者メールの一致確認は認可とは別に維持する', async () => {
  const source = await readFile(path.resolve('app/api/auth/register/route.ts'), 'utf8');
  assert.match(source, /configuredAdminEmail: adminEmail/);
  assert.match(source, /decision === 'admin_email_required'/);
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
  assert.ok(source.indexOf('invite_required') < source.indexOf('const decision = decideInitialSetupAuthorization'));
});

// ここから下は判定分岐そのものを実行する振る舞いテスト。
// 上のソース文字列検査は「実装が純関数を使い続けていること」の固定用として残す。

const ADMIN = 'owner@example.com';

test('管理者メール設定済み・トークン無し・Cookie無しは認可しない（PQA-003の再発防止本体）', async () => {
  const { decideInitialSetupAuthorization } = await import('../lib/setup-authorization.ts');
  const decision = decideInitialSetupAuthorization({
    configuredAdminEmail: ADMIN,
    email: ADMIN,
    setupTokenValid: false,
    setupCookieValid: false,
  });
  assert.equal(decision, 'invalid_setup_token');
});

test('管理者メール未設定でもトークン無しは認可しない', async () => {
  const { decideInitialSetupAuthorization } = await import('../lib/setup-authorization.ts');
  assert.equal(
    decideInitialSetupAuthorization({ configuredAdminEmail: null, email: 'a@example.com', setupTokenValid: false, setupCookieValid: false }),
    'invalid_setup_token',
  );
});

test('有効なトークンまたはセットアップCookieがあれば認可する', async () => {
  const { decideInitialSetupAuthorization } = await import('../lib/setup-authorization.ts');
  assert.equal(
    decideInitialSetupAuthorization({ configuredAdminEmail: ADMIN, email: ADMIN, setupTokenValid: true, setupCookieValid: false }),
    'authorized',
  );
  assert.equal(
    decideInitialSetupAuthorization({ configuredAdminEmail: ADMIN, email: ADMIN, setupTokenValid: false, setupCookieValid: true }),
    'authorized',
  );
  assert.equal(
    decideInitialSetupAuthorization({ configuredAdminEmail: null, email: 'a@example.com', setupTokenValid: true, setupCookieValid: false }),
    'authorized',
  );
});

test('管理者メール不一致はトークンが有効でも拒否する', async () => {
  const { decideInitialSetupAuthorization } = await import('../lib/setup-authorization.ts');
  assert.equal(
    decideInitialSetupAuthorization({ configuredAdminEmail: ADMIN, email: 'other@example.com', setupTokenValid: true, setupCookieValid: true }),
    'admin_email_required',
  );
});

test('管理者メールの一致判定は認可材料として扱われない（全16通りの網羅）', async () => {
  const { decideInitialSetupAuthorization } = await import('../lib/setup-authorization.ts');
  for (const configuredAdminEmail of [null, ADMIN]) {
    for (const email of [ADMIN, 'other@example.com']) {
      for (const setupTokenValid of [false, true]) {
        for (const setupCookieValid of [false, true]) {
          const decision = decideInitialSetupAuthorization({ configuredAdminEmail, email, setupTokenValid, setupCookieValid });
          const holdsSecret = setupTokenValid || setupCookieValid;
          if (decision === 'authorized') {
            // 認可されたケースは必ず秘密の所持を伴う。
            assert.ok(holdsSecret, `秘密なしで認可された: ${JSON.stringify({ configuredAdminEmail, email, setupTokenValid, setupCookieValid })}`);
          }
        }
      }
    }
  }
});

test('登録ルートは純関数の判定結果だけで分岐する', async () => {
  const source = await readFile(path.resolve('app/api/auth/register/route.ts'), 'utf8');
  assert.match(source, /decideInitialSetupAuthorization\(\{/);
  // adminEmail を単独で認可条件に使う分岐が復活していないこと。
  assert.doesNotMatch(source, /Boolean\(adminEmail\)\s*\|\|/);
  assert.doesNotMatch(source, /const setupAuthorized/);
  const decisionIndex = source.indexOf('const decision = decideInitialSetupAuthorization');
  const insertIndex = source.indexOf('INSERT INTO users');
  assert.ok(decisionIndex > -1 && insertIndex > -1 && decisionIndex < insertIndex, 'アカウント作成より前に認可判定が行われていない');
});
