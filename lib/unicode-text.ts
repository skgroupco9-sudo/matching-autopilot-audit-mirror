/** Unicode のコードポイント単位で長さを数える。絵文字を途中で分断しない。 */
export function unicodeLength(value: string) {
  return Array.from(value).length;
}

/** Unicode のコードポイント境界を保ったまま上限まで切り詰める。 */
export function truncateUnicode(value: string, maximumLength: number) {
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 0) return '';
  return Array.from(value).slice(0, maximumLength).join('');
}

export function normalizeUnicodeText(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().normalize('NFKC');
  const safeCharacters = Array.from(normalized).filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace = codePoint === 9 || codePoint === 10 || codePoint === 13;
    const isControl = (codePoint < 32 && !isAllowedWhitespace) || codePoint === 127;
    const isDirectionalOverride = (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
    const isUnpairedSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    return !isControl && !isDirectionalOverride && !isUnpairedSurrogate;
  });
  return safeCharacters.slice(0, maximumLength).join('');
}
