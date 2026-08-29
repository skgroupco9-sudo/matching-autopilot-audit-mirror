const directLineReferencePattern = /(?:\bline(?=$|[^a-z0-9_]|id|qr)|(?:^|[^ァ-ヶー])ライン(?![ァ-ヶー]))/iu;
const evasiveLineReferencePattern = /(?:緑(?:色)?の?(?:やつ|アプリ|アイコン|マーク|メッセージ)|緑の方|ラ[〇○◯o0]ン|(?:^|[^a-z])[il1]ine(?=$|[^a-z0-9_]))/iu;
const offPlatformSolicitationPattern = /(?:(?:連絡先|ID|QRコード).{0,12}(?:教えて|交換|送って)|(?:外部|別)の?アプリ.{0,12}(?:移動|話))/iu;
const politeJapanesePattern = /(?:です|ます|ません|でした|ました|でしょう|ください|ございます|ですね|ですよね|でしょうか|ですか|ますか)[。！？!?😊🙂☺️]*$/u;
const overlyCasualPattern = /(?:だよ|だね|じゃん|っしょ|だろ|やん|やで|せや|マジ|めっちゃ|ウケる|笑)(?:[。！？!?ｗw]*$|\s)/u;

export function normalizeReplyFingerprint(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

export function hasProhibitedOffPlatformReference(value) {
  const text = normalizeReplyFingerprint(value);
  return directLineReferencePattern.test(text)
    || evasiveLineReferencePattern.test(text)
    || offPlatformSolicitationPattern.test(text);
}

export function outgoingReplySafetyViolation(reply, avoidExamples = []) {
  if (hasProhibitedOffPlatformReference(reply)) return 'off_platform_reference';
  const fingerprint = normalizeReplyFingerprint(reply);
  if (!fingerprint) return 'empty_reply';
  if (avoidExamples.some((example) => normalizeReplyFingerprint(example) === fingerprint)) return 'duplicate_reply';
  if (avoidExamples.some((example) => replySimilarity(fingerprint, normalizeReplyFingerprint(example)) >= 0.86)) return 'near_duplicate_reply';
  if (overlyCasualPattern.test(fingerprint) || !politeJapanesePattern.test(fingerprint)) return 'polite_japanese_required';
  return null;
}

function replySimilarity(left, right) {
  if (!left || !right) return 0;
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) return left === right ? 1 : 0;
  let intersection = 0;
  for (const token of leftBigrams) if (rightBigrams.has(token)) intersection += 1;
  return (2 * intersection) / (leftBigrams.size + rightBigrams.size);
}

function bigrams(value) {
  const compact = value.replace(/[\s\p{P}\p{S}]+/gu, '');
  const result = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) result.add(compact.slice(index, index + 2));
  return result;
}
