import type { IdentityProfilePhotoCategory } from './identity-types';
import { normalizeUnicodeText } from './unicode-text.ts';

export const identityProfilePhotoLimits = {
  maximumCount: 6,
  maximumFileBytes: 8 * 1024 * 1024,
  maximumTotalBytes: 32 * 1024 * 1024,
} as const;

const categories = new Set<IdentityProfilePhotoCategory>([
  'face',
  'full_body',
  'hobby',
  'travel',
  'food',
  'pet',
  'other',
]);

export function normalizeIdentityProfilePhotoCategory(value: unknown): IdentityProfilePhotoCategory | null {
  return typeof value === 'string' && categories.has(value as IdentityProfilePhotoCategory)
    ? value as IdentityProfilePhotoCategory
    : null;
}

export function normalizeIdentityProfilePhotoCaption(value: unknown) {
  return normalizeUnicodeText(value, 120);
}

export function detectIdentityProfilePhotoContentType(bytes: Uint8Array) {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function identityProfilePhotoExtension(contentType: string) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return bytes.byteLength >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  if (bytes.byteLength < end) return '';
  return String.fromCharCode(...bytes.slice(start, end));
}
