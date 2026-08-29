export const marriageAppPolicy = {
  recommended: new Set(['ange', 'pairs', 'match', 'youbride', 'ravit', 'marrish', 'with', 'bridalnet', 'pcmax', 'laskoi', 'omiai', 'tapple', 'marimarriage', 'eveeve']),
  conditional: new Set(['yyc', 'casual', 'tinder', 'ensports', 'newmatch', 'paters', 'goldentree', 'paddy', 'cocome']),
  prohibited: new Set(['yoitoki', 'tantan', 'mitsumitsu', 'orca', 'tokimeco', 'tokyo-calendar-date', 'jmail', 'happymail', 'ikukuru', 'asobo', 'pairfull', 'tadakatsu', 'monie', 'sumotomo', 'tadaplus', 'tadahapi', 'himatalk', 'daracha', 'chattomo', 'loveun', 'mypappy', 'gravity']),
} as const;

export type MarriageAppPolicyTier = 'recommended' | 'conditional' | 'prohibited' | 'unclassified';

export function marriageAppPolicyTier(provider: string): MarriageAppPolicyTier {
  const normalized = provider.trim().toLocaleLowerCase('ja-JP');
  if (marriageAppPolicy.recommended.has(normalized)) return 'recommended';
  if (marriageAppPolicy.conditional.has(normalized)) return 'conditional';
  if (marriageAppPolicy.prohibited.has(normalized)) return 'prohibited';
  return 'unclassified';
}

export function isMarriageAppAllowedForPreparation(provider: string) {
  return marriageAppPolicyTier(provider) !== 'prohibited';
}

const prohibitedOccupationPattern = /(広告(?:関連)?|自衛隊|記者|\bIT\b|ＩＴ|金融|Web(?:関連)?|ウェブ(?:関連)?|警察官|弁護士)/iu;
const badIntentPattern = /(ヤリモク|遊び目的|不真面目|業者|投資勧誘|勧誘目的|卑猥|セフレ|パパ活)/iu;
const foreignLanguagePattern = /(外国人|外国籍|英語|中国語|韓国語|外国語|バイリンガル|日本語勉強中)/iu;

export type MarriageCandidate = {
  provider?: string;
  age?: number;
  profileText?: string;
  annualIncomeMinimum?: number;
  occupation?: string;
  likesCount?: number;
  hasNewBadge?: boolean;
  hasFacePhoto?: boolean;
  isPaidMember?: boolean;
};

export function assessMarriageCandidate(candidate: MarriageCandidate) {
  const provider = candidate.provider?.trim().toLocaleLowerCase('ja-JP') ?? '';
  const text = `${candidate.profileText ?? ''} ${candidate.occupation ?? ''}`.normalize('NFKC');
  const reasons: string[] = [];
  if (marriageAppPolicy.prohibited.has(provider)) reasons.push('禁止アプリです');
  if (candidate.age !== undefined && (candidate.age < 30 || candidate.age > 70)) reasons.push('対象年齢30〜70歳の範囲外です');
  if (candidate.annualIncomeMinimum !== undefined && candidate.annualIncomeMinimum < 400) reasons.push('年収400万円未満です');
  if (candidate.annualIncomeMinimum !== undefined && candidate.annualIncomeMinimum > 1200 && !/(医師|医者)/u.test(text)) reasons.push('年収1200万円超で医師以外のため業者確認が必要です');
  if (prohibitedOccupationPattern.test(text)) reasons.push('禁止職業ワードを検出しました');
  if (badIntentPattern.test(text)) reasons.push('不真面目・業者・卑猥な目的のワードを検出しました');
  if (foreignLanguagePattern.test(text)) reasons.push('日本語・日本人条件に合わない自己申告を検出しました');
  // いいね数が存在しない、非表示、DOMから測定不能なサービスは除外しない。
  // 数値として取得できた場合だけ上限を適用する。
  if (candidate.likesCount !== undefined && candidate.likesCount > 30) reasons.push('いいね数が30を超えています');
  if (provider === 'pairs' && candidate.hasNewBadge !== true) reasons.push('PairsはNEWまたは今週入会バッジが必須です');
  if (['match', 'bridalnet', 'eveeve'].includes(provider) && candidate.hasFacePhoto !== true) reasons.push('顔写真が必須のアプリです');
  if (provider === 'bridalnet' && candidate.isPaidMember !== true) reasons.push('ブライダルネットは課金会員が必須です');
  if (marriageAppPolicy.conditional.has(provider)) {
    if (candidate.age === undefined || candidate.age < 40) reasons.push('条件付きアプリは40歳以上が必須です');
    if (candidate.annualIncomeMinimum === undefined || candidate.annualIncomeMinimum < 600) reasons.push('条件付きアプリは年収600万円以上が必須です');
  }
  return { eligible: reasons.length === 0, reasons };
}

export function extractMarriageProfileFacts(value: string) {
  const text = value.normalize('NFKC');
  const incomeMatch = text.match(/年収[^0-9]{0,12}([0-9]{3,4})(?:\s*(?:万|万円))?/u);
  const likesMatch = text.match(/いいね(?:数)?[^0-9]{0,8}([0-9]{1,4})/u);
  return {
    annualIncomeMinimum: incomeMatch ? Number(incomeMatch[1]) : undefined,
    likesCount: likesMatch ? Number(likesMatch[1]) : undefined,
    hasNewBadge: /(?:NEW|今週入会|新規入会)/iu.test(text),
    isPaidMember: /(?:有料会員|課金済み|プレミアム会員)/u.test(text),
  };
}
