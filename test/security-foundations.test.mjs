import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { hashWorkerToken, isValidWorkerId, isValidWorkerToken } from '../lib/worker-auth-core.ts';
import { validateJsonMutation, validateSameOriginMutation } from '../lib/request-security.ts';
import { PASSWORD_ITERATIONS } from '../lib/password-policy.ts';

test('password hashing stays within the production Web Crypto limit', () => {
  assert.equal(PASSWORD_ITERATIONS, 100_000);
});

test('worker identifiers accept only bounded safe values', () => {
  assert.equal(isValidWorkerId('personal-windows-1'), true);
  assert.equal(isValidWorkerId('../personal-owner'), false);
  assert.equal(isValidWorkerId('a'.repeat(81)), false);
});

test('worker binding tokens require 256-bit lowercase hex', () => {
  const token = 'a1'.repeat(32);
  assert.equal(isValidWorkerToken(token), true);
  assert.equal(isValidWorkerToken(token.toUpperCase()), false);
  assert.equal(isValidWorkerToken('a1'.repeat(31)), false);
});

test('worker tokens are stored as deterministic SHA-256 hashes', async () => {
  const token = '01'.repeat(32);
  const hash = await hashWorkerToken(token);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.equal(await hashWorkerToken(token), hash);
});

test('browser mutation rejects cross-site requests and wrong JSON media types', async () => {
  const crossSite = new Request('https://matchpilot.example/api/test', { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } });
  assert.equal(validateSameOriginMutation(crossSite)?.status, 403);
  const wrongMedia = new Request('https://matchpilot.example/api/test', { method: 'POST', headers: { origin: 'https://matchpilot.example', 'content-type': 'text/plain' } });
  assert.equal(validateJsonMutation(wrongMedia)?.status, 415);
  const sameOrigin = new Request('https://matchpilot.example/api/test', { method: 'POST', headers: { origin: 'https://matchpilot.example', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } });
  assert.equal(validateJsonMutation(sameOrigin), null);
  const directPostWithoutBrowserContext = new Request('https://matchpilot.example/api/test', { method: 'POST', headers: { 'content-type': 'application/json' } });
  assert.equal(validateJsonMutation(directPostWithoutBrowserContext)?.status, 403);
  const browserSameOriginWithoutOrigin = new Request('https://matchpilot.example/api/test', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } });
  assert.equal(validateJsonMutation(browserSameOriginWithoutOrigin), null);
});

test('every mutation route has a browser-origin or signed-machine boundary', async () => {
  const routes = await findFiles(path.resolve('app/api'), (name) => name === 'route.ts');
  for (const route of routes) {
    const source = await readFile(route, 'utf8');
    if (!/export async function (?:POST|PUT|PATCH|DELETE)/.test(source)) continue;
    const normalizedPath = path.relative(process.cwd(), route).replaceAll('\\', '/');
    if (normalizedPath === 'app/api/telegram/webhook/route.ts') {
      assert.match(source, /TELEGRAM_WEBHOOK_SECRET/);
      assert.match(source, /secretsEqual/);
      continue;
    }
    if (normalizedPath === 'app/api/billing/webhook/route.ts') {
      assert.match(source, /verifyStripeWebhook/);
      continue;
    }
    if (normalizedPath.startsWith('app/api/worker/') && normalizedPath !== 'app/api/worker/bindings/route.ts') {
      assert.match(source, /authorizeWorkerRequest|authorizeWorkerForUser|isKnownWorkerForUser/);
      continue;
    }
    assert.match(
      source,
      /validate(?:Json|Multipart|SameOrigin)Mutation/,
      `${normalizedPath} is missing the shared browser mutation boundary`,
    );
  }
});

async function findFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(target, predicate);
    return predicate(entry.name) ? [target] : [];
  }));
  return nested.flat();
}
