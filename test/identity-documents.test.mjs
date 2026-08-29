import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectIdentityDocumentContentType,
  identityDocumentLimits,
  isAllowedIdentityDocumentSide,
  normalizeIdentityDocumentExpiry,
  normalizeIdentityDocumentKind,
  normalizeIdentityDocumentSide,
} from '../lib/identity-documents.ts';

test('本人確認書類の許可形式を実データの署名で判定する', () => {
  assert.equal(detectIdentityDocumentContentType(new Uint8Array([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(detectIdentityDocumentContentType(new TextEncoder().encode('%PDF-1.7\n')), 'application/pdf');
  assert.equal(detectIdentityDocumentContentType(new TextEncoder().encode('not an image')), null);
});

test('iPhoneのHEIC画像を受け付ける', () => {
  const bytes = new Uint8Array(12);
  bytes.set(new TextEncoder().encode('ftypheic'), 4);
  assert.equal(detectIdentityDocumentContentType(bytes), 'image/heic');
});

test('書類種別・面・有効期限を許可リストで検証する', () => {
  assert.equal(normalizeIdentityDocumentKind('drivers_license'), 'drivers_license');
  assert.equal(normalizeIdentityDocumentKind('password'), null);
  assert.equal(normalizeIdentityDocumentSide('back'), 'back');
  assert.equal(normalizeIdentityDocumentSide('both'), null);
  assert.equal(normalizeIdentityDocumentExpiry('2030-02-28'), '2030-02-28');
  assert.equal(normalizeIdentityDocumentExpiry('2030-02-31'), null);
  assert.equal(isAllowedIdentityDocumentSide('my_number_card', 'front'), true);
  assert.equal(isAllowedIdentityDocumentSide('my_number_card', 'back'), false);
});

test('保存上限を端末写真向けの安全な範囲に固定する', () => {
  assert.equal(identityDocumentLimits.maximumCount, 8);
  assert.equal(identityDocumentLimits.maximumFileBytes, 12 * 1024 * 1024);
  assert.equal(identityDocumentLimits.maximumTotalBytes, 60 * 1024 * 1024);
});
