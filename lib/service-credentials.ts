import type { PasswordServiceOption } from './identity-types';
import { isServicePasswordCompatible } from './service-password-generation.ts';
import { normalizeUnicodeText, unicodeLength } from './unicode-text.ts';

export const serviceCredentialLimits = {
  maximumCount: 120,
  minimumPasswordLength: 4,
  maximumPasswordLength: 128,
  maximumLoginIdLength: 254,
  maximumServiceLabelLength: 80,
} as const;

const knownServiceKeyPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const customServiceKeyPattern = /^custom_[0-9a-f]{32}$/;

export function normalizeServiceKey(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return knownServiceKeyPattern.test(normalized) || customServiceKeyPattern.test(normalized) ? normalized : '';
}

export function normalizeServiceLabel(value: unknown) {
  return normalizeUnicodeText(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, serviceCredentialLimits.maximumServiceLabelLength);
}

export function normalizeCredentialLoginId(value: unknown) {
  return normalizeUnicodeText(value, serviceCredentialLimits.maximumLoginIdLength);
}

export function validServicePassword(value: unknown, serviceKey = ''): value is string {
  return typeof value === 'string'
    && isServicePasswordCompatible(serviceKey, value);
}

export function maskCredentialLoginId(value: string) {
  if (!value) return 'ログインID未設定';
  const at = value.indexOf('@');
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    return `${local.slice(0, Math.min(2, local.length))}${'•'.repeat(Math.max(3, Math.min(8, local.length - 2)))}@${domain}`;
  }
  const characters = Array.from(value);
  if (unicodeLength(value) <= 4) return `${characters[0] ?? ''}${'•'.repeat(Math.max(3, characters.length - 1))}`;
  return `${characters.slice(0, 2).join('')}${'•'.repeat(Math.min(8, characters.length - 4))}${characters.slice(-2).join('')}`;
}

export async function createCustomServiceKey(userId: string, label: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${label.toLocaleLowerCase('ja-JP')}`));
  return `custom_${Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function isKnownPasswordService(serviceKey: string, services: PasswordServiceOption[]) {
  return services.some((service) => service.id === serviceKey);
}
