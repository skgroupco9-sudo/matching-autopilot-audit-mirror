export type AcquiredContactIdentity = {
  displayName?: string | null;
  age?: number | null;
  lineId?: string | null;
  lineUrl?: string | null;
};

export function normalizeAcquiredDisplayName(value: string | null | undefined) {
  return value
    ?.normalize('NFKC')
    .replace(/[\s・._-]+/gu, '')
    .toLocaleLowerCase('ja-JP') || undefined;
}

export function normalizeAcquiredLine(value: string | null | undefined) {
  if (!value) return undefined;
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (/^@[a-z0-9][a-z0-9._-]{2,39}$/i.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    if (!['line.me', 'www.line.me', 'lin.ee', 'www.lin.ee'].includes(url.hostname.toLocaleLowerCase('en-US'))) return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function acquiredNameAgeHash(identity: AcquiredContactIdentity) {
  const name = normalizeAcquiredDisplayName(identity.displayName);
  if (!name || !Number.isInteger(identity.age)) return undefined;
  return acquiredHash(`name_age:${name}:${identity.age}`);
}

export async function acquiredLineHash(identity: AcquiredContactIdentity) {
  const line = normalizeAcquiredLine(identity.lineId) ?? normalizeAcquiredLine(identity.lineUrl);
  return line ? acquiredHash(`line:${line}`) : undefined;
}

export function sameAcquiredNameAge(left: AcquiredContactIdentity, right: AcquiredContactIdentity) {
  const leftName = normalizeAcquiredDisplayName(left.displayName);
  const rightName = normalizeAcquiredDisplayName(right.displayName);
  return Boolean(leftName && rightName && leftName === rightName && Number.isInteger(left.age) && left.age === right.age);
}

async function acquiredHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
