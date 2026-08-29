// PQA-005 の回帰テスト。
// 本番と同一のSQL文字列（lib/auth-challenge-policy.ts の CLAIM_AUTH_CHALLENGE_ATTEMPT_SQL）を
// node:sqlite 上で実行し、試行枠の確保がデータベース側の1文で完結することを検証する。
// node:sqlite は ?1 形式の番号付きパラメータに対応しないため、実行前に無名 ? へ展開する。
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AUTH_CHALLENGE_MAX_ATTEMPTS,
  CLAIM_AUTH_CHALLENGE_ATTEMPT_SQL,
} from '../lib/auth-challenge-policy.ts';

const CHALLENGE_ID = `challenge_${'a'.repeat(32)}`;

function expandNumberedParameters(sql) {
  const order = [];
  const expanded = sql.replace(/\?(\d+)/g, (_match, index) => {
    order.push(Number(index));
    return '?';
  });
  return { sql: expanded, order };
}

function bindInOrder(order, args) {
  return order.map((index) => args[index - 1]);
}

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE auth_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL
  )`);
  return db;
}

function seed(db, overrides = {}) {
  const row = {
    id: CHALLENGE_ID,
    user_id: 'user_1',
    kind: 'login_mfa',
    code_hash: 'deadbeef',
    attempts: 0,
    expires_at: Date.now() + 600_000,
    consumed_at: null,
    created_at: Date.now(),
    ...overrides,
  };
  db.prepare(
    'INSERT INTO auth_challenges (id, user_id, kind, code_hash, attempts, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.user_id, row.kind, row.code_hash, row.attempts, row.expires_at, row.consumed_at, row.created_at);
  return row;
}

function claim(db, { id = CHALLENGE_ID, kind = 'login_mfa', now = Date.now() } = {}) {
  const { sql, order } = expandNumberedParameters(CLAIM_AUTH_CHALLENGE_ATTEMPT_SQL);
  const args = [id, kind, now, AUTH_CHALLENGE_MAX_ATTEMPTS];
  return db.prepare(sql).get(...bindInOrder(order, args));
}

test('1. 本番のSQLは単一のUPDATE文で加算し、RETURNINGで実際の値を返す', () => {
  const sql = CLAIM_AUTH_CHALLENGE_ATTEMPT_SQL;
  assert.match(sql, /^UPDATE auth_challenges/);
  assert.match(sql, /SET attempts = attempts \+ 1/);
  assert.match(sql, /RETURNING user_id, code_hash, attempts/);
  // 検証前に枠を確保するため、加算と上限判定が同じ文の中にあること
  assert.match(sql, /AND attempts < \?4/);
  assert.equal(sql.split('UPDATE').length - 1, 1, 'UPDATEは1文のみ');
  assert.ok(!/SELECT/i.test(sql), '読み取りと書き込みを分けない');
});

test('2. 逐次実行で attempts が 1 から上限まで増え、上限到達後は枠が取れない', () => {
  const db = createDb();
  seed(db);
  const observed = [];
  for (let i = 0; i < AUTH_CHALLENGE_MAX_ATTEMPTS + 3; i += 1) {
    const row = claim(db);
    observed.push(row ? row.attempts : null);
  }
  assert.deepEqual(observed, [1, 2, 3, 4, 5, null, null, null]);
  const stored = db.prepare('SELECT attempts FROM auth_challenges WHERE id = ?').get(CHALLENGE_ID);
  assert.equal(stored.attempts, AUTH_CHALLENGE_MAX_ATTEMPTS, '上限を超えて加算されない');
  db.close();
});

test('3. 同一ミリ秒で連続実行しても総試行回数が上限を超えない', () => {
  const db = createDb();
  seed(db);
  const now = Date.now();
  let granted = 0;
  for (let i = 0; i < 50; i += 1) {
    if (claim(db, { now })) granted += 1;
  }
  assert.equal(granted, AUTH_CHALLENGE_MAX_ATTEMPTS, `50回の要求のうち枠を得たのは ${granted} 件`);
  db.close();
});

test('4. 消費済み・期限切れ・種別不一致・不明IDでは枠を取れない', () => {
  const consumed = createDb();
  seed(consumed, { consumed_at: Date.now() });
  assert.equal(claim(consumed), undefined, '消費済み');
  consumed.close();

  const expired = createDb();
  seed(expired, { expires_at: Date.now() - 1 });
  assert.equal(claim(expired), undefined, '期限切れ');
  expired.close();

  const wrongKind = createDb();
  seed(wrongKind, { kind: 'password_reset' });
  assert.equal(claim(wrongKind), undefined, '種別不一致');
  // 同一IDでも kind を合わせれば取れる = 条件が kind に依存していることの確認
  assert.equal(claim(wrongKind, { kind: 'password_reset' }).attempts, 1);
  wrongKind.close();

  const unknown = createDb();
  seed(unknown);
  assert.equal(claim(unknown, { id: `challenge_${'b'.repeat(32)}` }), undefined, '不明ID');
  unknown.close();
});

test('5. 返される code_hash と user_id は格納値と一致する（検証はこの値で行う）', () => {
  const db = createDb();
  const row = seed(db, { code_hash: 'abc123', user_id: 'user_42' });
  const claimed = claim(db);
  assert.equal(claimed.code_hash, row.code_hash);
  assert.equal(claimed.user_id, row.user_id);
  db.close();
});

test('6. negative control: 読み取り後に絶対値を書き戻す旧方式は上限を超える', () => {
  const db = createDb();
  seed(db);
  const now = Date.now();
  // 修正前の実装と同じ順序：先に読み、JavaScript側で +1 して絶対値を書く
  const readRows = [];
  for (let i = 0; i < 10; i += 1) {
    readRows.push(db.prepare('SELECT attempts FROM auth_challenges WHERE id = ? AND kind = ?').get(CHALLENGE_ID, 'login_mfa'));
  }
  let granted = 0;
  for (const row of readRows) {
    if (row.attempts < AUTH_CHALLENGE_MAX_ATTEMPTS) {
      db.prepare('UPDATE auth_challenges SET attempts = ? WHERE id = ?').run(row.attempts + 1, CHALLENGE_ID);
      granted += 1;
    }
  }
  assert.equal(granted, 10, '旧方式では10回すべてが上限判定を通過する');
  const stored = db.prepare('SELECT attempts FROM auth_challenges WHERE id = ?').get(CHALLENGE_ID);
  assert.equal(stored.attempts, 1, '旧方式では加算が失われ、カウンタが1のまま');
  assert.ok(now <= Date.now());
  db.close();
});

test('7. consumeTelegramAuthChallenge は検証より前に枠を確保し、読み取り加算を残していない', () => {
  const source = readFileSync(new URL('../lib/auth-challenges.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function consumeTelegramAuthChallenge');
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf('\n}', start) + 2);

  const claimIndex = body.indexOf('CLAIM_AUTH_CHALLENGE_ATTEMPT_SQL');
  const verifyIndex = body.indexOf('secretsEqual');
  assert.notEqual(claimIndex, -1, '本番のSQL定数を使っている');
  assert.notEqual(verifyIndex, -1);
  assert.ok(claimIndex < verifyIndex, 'コード比較より前に試行枠を確保している');
  assert.ok(!/attempts:\s*\w+\.attempts \+ 1/.test(body), '読み取り値からの加算が残っていない');
  assert.ok(!/eq\(authChallenges\.attempts/.test(body), 'attempts を条件に使う楽観ロックに戻っていない');
});
