export type ApprovedLearning = {
  category: 'unclassified' | 'report_example' | 'conversation_example' | 'ng_rule';
  text: string;
};

import { truncateUnicode, unicodeLength } from './unicode-text.ts';

const protectedReportPattern = /(確認が必要|条件を達成|認証|安全|停止|エラー|失敗|ブロック)/i;

export function redactTelegramLearningText(value: string) {
  const redacted = value
    .normalize('NFKC')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[メール]')
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .replace(/@[A-Za-z0-9_]{4,32}/g, '[ユーザー名]')
    .replace(/((?:LINE|ライン)\s*(?:の\s*)?(?:ID)?\s*[:：=]?\s*)(?!\[(?:連絡先|URL)\]|QR(?:コード)?\b)[A-Za-z0-9._-]{3,40}/gi, '$1[連絡先]')
    .replace(/(?:\+?81[-\s]?)?(?:0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4})/g, '[電話番号]')
    .replace(/\b\d{4,8}\b/g, '[認証情報]')
    .replace(/((?:氏名|名前|お名前|本名)\s*[:：=]\s*)(?!\[氏名\])[^\s、,。\n]{1,30}(?:\s+[一-龠々ヵヶァ-ヶーぁ-ん]{1,15})?/g, '$1[氏名]')
    .replace(/((?:氏名|名前|お名前|本名)\s+)(?!\[氏名\])[^\s、,。\n]{1,30}(?:\s+[一-龠々ヵヶァ-ヶーぁ-ん]{1,15})?/g, '$1[氏名]')
    .replace(/(\[氏名\])(?:\s+[一-龠々ヵヶァ-ヶーぁ-ん]{1,15}){1,3}[)）]?/g, '$1')
    .replace(/((?:実家(?:住所)?|住所|所在地)\s*[:：=]\s*)(?!\[住所\])[^\s、,。\n]{1,100}/g, '$1[住所]')
    .replace(/((?:実家(?:住所)?|住所|所在地)\s+)(?!\[住所\])[^\s、,。\n]{1,100}/g, '$1[住所]')
    .replace(/((?:自分(?:が使用して(?:い?る)?)?の?アカウント)\s*[:：=]\s*)(?!\[氏名\])[^\s、,。\n]{1,30}/g, '$1[氏名]')
    .replace(/(?:password|pass|パスワード|暗証番号)\s*[:：=]\s*\S+/gi, '$1: [機密情報]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return truncateUnicode(redacted, 1600);
}

export function applyLearnedReportStyle(original: string, learned: ApprovedLearning[]) {
  if (!learned.length) return original;
  const ngTerms = learned
    .filter((item) => item.category === 'ng_rule')
    .flatMap((item) => item.text.split(/[、,\n]/))
    .map((item) => item.replace(/^(NG|禁止|不要)\s*[:：]?\s*/i, '').trim())
    .filter((item) => unicodeLength(item) >= 2 && unicodeLength(item) <= 80);

  let lines = original.split('\n').filter((line, index) => {
    if (index === 0 || protectedReportPattern.test(line)) return true;
    const normalized = line.toLocaleLowerCase('ja-JP');
    return !ngTerms.some((term) => normalized.includes(term.toLocaleLowerCase('ja-JP')));
  });

  const example = learned.find((item) => item.category === 'report_example')?.text;
  if (!example) return lines.join('\n');
  const bullet = example.match(/^\s*(・|•|■|□|●|▶|→|-)(?=\s|\S)/m)?.[1];
  if (bullet) {
    lines = lines.map((line, index) => index > 0 && line && /[:：]/.test(line) ? `${bullet} ${line}` : line);
  }
  const usesSpacedLines = /\S\n\s*\n\S/.test(example);
  return usesSpacedLines ? lines.filter(Boolean).join('\n\n') : lines.join('\n');
}

export function learningPreview(value: string) {
  return unicodeLength(value) > 220 ? `${truncateUnicode(value, 220)}…` : value;
}
