const lineUrlPattern = /https?:\/\/(?:line\.me|lin\.ee)\/[^\s<>"'「」『』]+/giu;
const lineIdPattern = /(?:LINE|ライン)\s*(?:ID|ＩＤ|アイディー|アカウント)?\s*(?:は|[:：=])\s*(@?[a-z0-9][a-z0-9._-]{2,39})/giu;
const lineQrPattern = /(?:(?:LINE|ライン)[^\n]{0,20}(?:QR|ＱＲ)(?:コード)?|(?:QR|ＱＲ)(?:コード)?[^\n]{0,20}(?:LINE|ライン))/iu;
const ignoredIds = new Set(['line', 'id', 'qr', 'https', 'http', 'none', 'null', 'なし']);

export function extractContactExchange(value) {
  const text = typeof value === 'string' ? value.normalize('NFKC').slice(0, 4000) : '';
  const urls = [...text.matchAll(lineUrlPattern)]
    .map((match) => normalizeLineUrl(match[0]))
    .filter(Boolean);
  const lineUrl = urls[0] ?? null;
  const urlLineId = lineUrl ? extractLineIdFromUrl(lineUrl) : null;
  const textLineId = [...text.matchAll(lineIdPattern)]
    .map((match) => normalizeLineId(match[1]))
    .find(Boolean) ?? null;
  const lineId = urlLineId ?? textLineId;
  const qrMentioned = lineQrPattern.test(text);
  const detected = Boolean(lineId || lineUrl || qrMentioned);

  return {
    detected,
    channel: detected ? 'line' : null,
    lineId,
    lineUrl,
    qrMentioned,
    evidenceType: lineId ? 'line_id' : lineUrl ? 'line_url' : qrMentioned ? 'line_qr' : null,
  };
}

export function normalizeLineId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalized) || ignoredIds.has(normalized)) return null;
  return `@${normalized}`;
}

export function normalizeLineUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[.,。、，！!？?）)\]】]+$/u, '');
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || !['line.me', 'www.line.me', 'lin.ee', 'www.lin.ee'].includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractLineIdFromUrl(value) {
  try {
    const path = decodeURIComponent(new URL(value).pathname);
    const match = path.match(/\/(?:R\/)?ti\/p\/(?:~|@)?([a-z0-9][a-z0-9._-]{2,39})/iu);
    return match ? normalizeLineId(match[1]) : null;
  } catch {
    return null;
  }
}
