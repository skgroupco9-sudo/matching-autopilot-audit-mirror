import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectIdentityProfilePhotoContentType,
  identityProfilePhotoExtension,
  identityProfilePhotoLimits,
  normalizeIdentityProfilePhotoCaption,
  normalizeIdentityProfilePhotoCategory,
} from '../lib/identity-profile-photos.ts';

test('プロフィール写真は実データの署名でJPEG・PNG・WebPだけを受け付ける', () => {
  assert.equal(detectIdentityProfilePhotoContentType(new Uint8Array([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(detectIdentityProfilePhotoContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(detectIdentityProfilePhotoContentType(new TextEncoder().encode('RIFFxxxxWEBP')), 'image/webp');
  assert.equal(detectIdentityProfilePhotoContentType(new TextEncoder().encode('%PDF-1.7')), null);
});

test('用途・説明・保存上限を固定する', () => {
  assert.equal(normalizeIdentityProfilePhotoCategory('face'), 'face');
  assert.equal(normalizeIdentityProfilePhotoCategory('identity_document'), null);
  assert.equal(normalizeIdentityProfilePhotoCaption(`  ${'a'.repeat(140)}  `).length, 120);
  assert.equal(identityProfilePhotoLimits.maximumCount, 6);
  assert.equal(identityProfilePhotoLimits.maximumFileBytes, 8 * 1024 * 1024);
  assert.equal(identityProfilePhotoLimits.maximumTotalBytes, 32 * 1024 * 1024);
  assert.equal(identityProfilePhotoExtension('image/webp'), 'webp');
});
