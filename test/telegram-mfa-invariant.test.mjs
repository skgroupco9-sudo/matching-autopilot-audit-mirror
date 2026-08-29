import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// PQA-001 回帰防止。
// 不変条件: users.telegram_mfa_enabled = true は users.telegram_chat_id が存在する場合のみ許される。
// この不変条件が破れると app/api/auth/login/route.ts の
// `telegramMfaEnabled && telegramChatId` 判定が偽になり、
// UI 上は 2 段階認証が有効のままパスワード単独ログインが通る。

async function findFiles(dir, matches) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findFiles(full, matches)));
    } else if (matches(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function extractSetPayloads(source) {
  const payloads = [];
  const marker = '.set({';
  let index = source.indexOf(marker);
  while (index !== -1) {
    let depth = 0;
    let end = index + marker.length - 1;
    for (let cursor = end; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }
    payloads.push(source.slice(index, end + 1));
    index = source.indexOf(marker, end + 1);
  }
  return payloads;
}

test('telegram_chat_id を解除する更新は必ず telegram_mfa_enabled も false にする', async () => {
  const sources = await findFiles(path.resolve('app'), (name) => name.endsWith('.ts') || name.endsWith('.tsx'));
  sources.push(...(await findFiles(path.resolve('lib'), (name) => name.endsWith('.ts'))));
  let inspected = 0;
  for (const file of sources) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('telegramChatId: null')) continue;
    for (const payload of extractSetPayloads(source)) {
      if (!payload.includes('telegramChatId: null')) continue;
      inspected += 1;
      assert.ok(
        payload.includes('telegramMfaEnabled: false'),
        `${path.relative(process.cwd(), file)} は telegram_chat_id を解除する際に telegram_mfa_enabled を false にしていない: ${payload}`,
      );
    }
  }
  assert.ok(inspected >= 2, `telegram_chat_id を解除する更新が検出できなかった (検出数 ${inspected})`);
});

test('ログイン時の 2 段階認証判定は chat_id と MFA フラグの両方に依存し続ける', async () => {
  const source = await readFile(path.resolve('app/api/auth/login/route.ts'), 'utf8');
  assert.match(source, /telegramMfaEnabled\s*&&\s*account\[0\]\.telegramChatId/);
  assert.match(source, /mfaRequired:\s*true/);
});

test('MFA 有効化は Telegram 連携済みを必須にする', async () => {
  const source = await readFile(path.resolve('app/api/auth/mfa/settings/route.ts'), 'utf8');
  assert.match(source, /telegram_required/);
  assert.match(source, /status:\s*409/);
});

test('Telegram 連携解除経路は MFA 有効時に 409 で拒否する', async () => {
  const source = await readFile(path.resolve('app/api/actions/route.ts'), 'utf8');
  assert.match(source, /disable_mfa_first/);
});

// Codexレビュー指摘（PR #1 / P1）の回帰防止。
// 同じチャットを本人が再リンクした場合、解除対象に本人が含まれると
// telegram_mfa_enabled が false のまま残る。

test('紐付け解除の対象から本人を除外する', async () => {
  const source = await readFile(path.resolve('app/api/telegram/webhook/route.ts'), 'utf8');
  const clearing = source.split('\n').slice(
    source.split('\n').findIndex((value) => value.includes('telegramMfaEnabled: false')),
  ).slice(0, 3).join('\n');
  assert.match(clearing, /ne\(users\.id, tokenRows\[0\]\.userId\)/);
  assert.match(clearing, /and\(eq\(users\.telegramChatId, String\(chatId\)\)/);
});

test('drizzle-orm の ne を取り込んでいる', async () => {
  const source = await readFile(path.resolve('app/api/telegram/webhook/route.ts'), 'utf8');
  assert.match(source, /import \{[^}]*\bne\b[^}]*\} from 'drizzle-orm';/);
});
