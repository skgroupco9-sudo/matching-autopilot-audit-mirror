import type { IdentityDocumentKind, IdentityDocumentSide } from './identity-types';

export const identityDocumentLimits = {
  maximumCount: 8,
  maximumFileBytes: 12 * 1024 * 1024,
  maximumTotalBytes: 60 * 1024 * 1024,
} as const;

export const identityDocumentKinds = new Set<IdentityDocumentKind>([
  'drivers_license',
  'passport',
  'my_number_card',
  'residence_card',
  'health_insurance',
  'other',
]);

export const identityDocumentSides = new Set<IdentityDocumentSide>(['single', 'front', 'back']);

export function normalizeIdentityDocumentKind(value: unknown): IdentityDocumentKind | null {
  return typeof value === 'string' && identityDocumentKinds.has(value as IdentityDocumentKind)
    ? value as IdentityDocumentKind
    : null;
}

export function normalizeIdentityDocumentSide(value: unknown): IdentityDocumentSide | null {
  return typeof value === 'string' && identityDocumentSides.has(value as IdentityDocumentSide)
    ? value as IdentityDocumentSide
    : null;
}

export function isAllowedIdentityDocumentSide(kind: IdentityDocumentKind, side: IdentityDocumentSide) {
  return !(kind === 'my_number_card' && side === 'back');
}

export function normalizeIdentityDocumentExpiry(value: unknown) {
  if (value === '' || value == null) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

export function detectIdentityDocumentContentType(bytes: Uint8Array) {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';

  const brand = ascii(bytes, 4, 12).toLowerCase();
  if (brand.startsWith('ftyp')) {
    const imageBrand = brand.slice(4);
    if (['heic', 'heix', 'hevc', 'hevx'].includes(imageBrand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(imageBrand)) return 'image/heif';
  }

  return null;
}

export function identityDocumentExtension(contentType: string) {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'application/pdf': 'pdf',
  };
  return extensions[contentType] ?? 'bin';
}

export function isExpiredIdentityDocument(expiresOn: string, now = new Date()) {
  if (!expiresOn) return false;
  return expiresOn < now.toISOString().slice(0, 10);
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return bytes.byteLength >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  if (bytes.byteLength < end) return '';
  return String.fromCharCode(...bytes.slice(start, end));
}
