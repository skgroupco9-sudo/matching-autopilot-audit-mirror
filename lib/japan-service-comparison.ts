export type ComparisonGoal = 'relationship' | 'marriage' | 'remarriage' | 'companionship';
export type ComparisonAgeBand = '20s' | '30s' | '40s' | '50plus';
export type ComparisonPriority = 'least_work' | 'values' | 'serious';

export type JapaneseServiceProfile = {
  id: string;
  label: string;
  summary: string;
  goals: ComparisonGoal[];
  specialties?: ComparisonGoal[];
  ageBands: ComparisonAgeBand[];
  webAccess: 'available' | 'app_only';
  minimumAge: string;
  registration: string[];
  identityStep: string;
  strengths: string[];
  cautions: string[];
  valuesFocus: boolean;
  seriousFocus: boolean;
  nativeAutomation: 'matching_likes' | 'none';
  externalAutomationStatus: 'prohibited' | 'unverified' | 'official_native';
  matchPilotConnection: 'prepare' | 'official_only';
  officialUrl: string;
  evidenceUrl: string;
  termsUrl: string;
  checkedAt: string;
};

const checkedAt = '2026-08-25';

export const japaneseServiceProfiles: JapaneseServiceProfile[] = [
  {
    id: 'ravit',
    label: 'Ravit',
    summary: '公式AIエージェントが相性候補への「いいね」を送る、手間の少なさを優先しやすい恋活・婚活サービス。',
    goals: ['relationship', 'marriage'],
    ageBands: ['20s', '30s', '40s'],
    webAccess: 'available',
    minimumAge: '18歳以上・独身（高校生を除く）',
    registration: ['公式画面で確認'],
    identityStep: 'メッセージ交換前に公的身分証による本人確認',
    strengths: ['公式AIが相性候補へ無料いいね', '条件検索', 'Web利用を公式ヘルプで確認'],
    cautions: ['AIいいねは公式機能の範囲', '会話の完全自動送信は公式機能として未確認'],
    valuesFocus: true,
    seriousFocus: true,
    nativeAutomation: 'matching_likes',
    externalAutomationStatus: 'official_native',
    matchPilotConnection: 'official_only',
    officialUrl: 'https://ravit.jp/',
    evidenceUrl: 'https://support.ravit.jp/hc/ja/articles/900000954846-AI%E3%82%A8%E3%83%BC%E3%82%B8%E3%82%A7%E3%83%B3%E3%83%88',
    termsUrl: 'https://ravit.jp/terms',
    checkedAt,
  },
  {
    id: 'pairs',
    label: 'Pairs',
    summary: '幅広い条件で恋活・婚活の候補を探せる国内大手。本人確認では年齢と複数アカウントの有無を確認。',
    goals: ['relationship', 'marriage'],
    ageBands: ['20s', '30s', '40s', '50plus'],
    webAccess: 'available',
    minimumAge: '18歳以上',
    registration: ['LINE', 'Apple', 'Google', '電話番号・メールアドレス'],
    identityStep: 'メッセージ等の利用に本人確認',
    strengths: ['幅広い年代・目的', 'Web入口あり', '詳細な条件・価値観で探しやすい'],
    cautions: ['外部自動操作の公式許可を確認できていない', '複数アカウントは本人確認の確認対象'],
    valuesFocus: true,
    seriousFocus: false,
    nativeAutomation: 'none',
    externalAutomationStatus: 'unverified',
    matchPilotConnection: 'official_only',
    officialUrl: 'https://pairs.lv/',
    evidenceUrl: 'https://support.pairs.lv/hc/ja/articles/115007254088-%E6%9C%AC%E4%BA%BA%E7%A2%BA%E8%AA%8D%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6',
    termsUrl: 'https://pairs.lv/static/termsofservice',
    checkedAt,
  },
  {
    id: 'with',
    label: 'with',
    summary: '心理テスト・好みカード・For Youで、見た目だけでなく価値観や共通点を重視した恋活・婚活向け。',
    goals: ['relationship', 'marriage'],
    ageBands: ['20s', '30s', '40s'],
    webAccess: 'available',
    minimumAge: '18歳以上・独身（高校生を除く）',
    registration: ['LINE', '電話番号', 'Apple', 'Facebook'],
    identityStep: '公的証明書による本人確認が必須',
    strengths: ['価値観・性格診断', '共通の趣味を探せる好みカード', 'Web登録・ログイン'],
    cautions: ['公式規約が自動投稿・巡回ツール等を禁止', '1人で複数アカウントの作成・保有は禁止'],
    valuesFocus: true,
    seriousFocus: false,
    nativeAutomation: 'none',
    externalAutomationStatus: 'prohibited',
    matchPilotConnection: 'official_only',
    officialUrl: 'https://with.is/welcome',
    evidenceUrl: 'https://with.is/welcome',
    termsUrl: 'https://with.is/terms_of_use',
    checkedAt,
  },
  {
    id: 'omiai',
    label: 'Omiai',
    summary: '恋愛・結婚相手を真剣に探す独身者向け。LINE・電話番号などでブラウザ版へログイン可能。',
    goals: ['relationship', 'marriage'],
    ageBands: ['20s', '30s', '40s'],
    webAccess: 'available',
    minimumAge: '18歳以上・独身（高校生を除く）',
    registration: ['LINE', '電話番号', 'Apple（対応端末）'],
    identityStep: 'メール認証・本人確認などを公式画面で実施',
    strengths: ['真剣な恋活・婚活', 'ブラウザ版ログインを公式確認', '複数の認証方法'],
    cautions: ['公式規約が自動投稿・巡回ツール等を禁止', '本人以外による人格代行は行わない'],
    valuesFocus: false,
    seriousFocus: true,
    nativeAutomation: 'none',
    externalAutomationStatus: 'prohibited',
    matchPilotConnection: 'official_only',
    officialUrl: 'https://www.omiai-jp.com/login',
    evidenceUrl: 'https://support.omiai-jp.com/hc/ja/articles/24878132286745-%E3%83%96%E3%83%A9%E3%82%A6%E3%82%B6%E7%89%88%E3%81%AE%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3%E6%96%B9%E6%B3%95%E3%82%92%E6%95%99%E3%81%88%E3%81%A6%E3%81%8F%E3%81%A0%E3%81%95%E3%81%84',
    termsUrl: 'https://fb.omiai-jp.com/japan/site/kiyaku/',
    checkedAt,
  },
  {
    id: 'marrish',
    label: 'marrish',
    summary: '恋活・婚活に加え、再婚・シンママ・シンパパ・中年婚を公式に打ち出す再婚重視の候補。',
    goals: ['marriage', 'remarriage', 'companionship'],
    specialties: ['remarriage'],
    ageBands: ['30s', '40s', '50plus'],
    webAccess: 'available',
    minimumAge: '18歳以上',
    registration: ['電話番号', 'メール', 'Apple', 'LINE', 'Amazon'],
    identityStep: 'SMS／メール認証と年齢・本人確認',
    strengths: ['再婚・子育て中の出会いを明示的に支援', '40代・50代の公式事例', 'ブラウザ版あり'],
    cautions: ['公式規約が投稿コンテンツの自動収集・解析を禁止', 'Facebook登録は廃止'],
    valuesFocus: false,
    seriousFocus: true,
    nativeAutomation: 'none',
    externalAutomationStatus: 'prohibited',
    matchPilotConnection: 'official_only',
    officialUrl: 'https://link.marrish.com/',
    evidenceUrl: 'https://marrish.com/auth/registhelp',
    termsUrl: 'https://marrish.com/auth/userpolicy',
    checkedAt,
  },
  {
    id: 'youbride',
    label: 'youbride',
    summary: '30〜40代以上を中心に、結婚を前提とした交際を探す婚活特化サービス。再婚希望にも対応。',
    goals: ['marriage', 'remarriage'],
    ageBands: ['30s', '40s', '50plus'],
    webAccess: 'available',
    minimumAge: '18歳以上・独身（高校生を除く）',
    registration: ['メール・ログインID'],
    identityStep: '年齢確認とメイン顔写真が必要',
    strengths: ['30〜40代以上が中心', '男女同額の婚活設計', 'Webで検索・メッセージ'],
    cautions: ['年齢確認前は利用制限', '外部自動操作の公式許可は未確認'],
    valuesFocus: false,
    seriousFocus: true,
    nativeAutomation: 'none',
    externalAutomationStatus: 'unverified',
    matchPilotConnection: 'prepare',
    officialUrl: 'https://youbride.jp/',
    evidenceUrl: 'https://youbride.jp/guide/',
    termsUrl: 'https://youbride.jp/docs/rule',
    checkedAt,
  },
  {
    id: 'bridalnet',
    label: 'ブライダルネット',
    summary: '結婚への真剣度を重視し、日記・コミュニティ・条件検索・紹介機能を備える20歳以上向け婚活サービス。',
    goals: ['marriage'],
    ageBands: ['20s', '30s', '40s', '50plus'],
    webAccess: 'available',
    minimumAge: '20歳以上・独身（男性は定職が必要）',
    registration: ['メールアドレス', '電話認証'],
    identityStep: '登録時の電話認証、メッセージ前の公的証明書による本人確認',
    strengths: ['結婚への真剣度を重視', '価値観が分かる日記', 'Web版とトライアルあり'],
    cautions: ['男性の入会資格に定職要件', '外部自動操作の公式許可は未確認'],
    valuesFocus: true,
    seriousFocus: true,
    nativeAutomation: 'none',
    externalAutomationStatus: 'unverified',
    matchPilotConnection: 'prepare',
    officialUrl: 'https://www.bridalnet.co.jp/',
    evidenceUrl: 'https://www.bridalnet.co.jp/safe/auth.html',
    termsUrl: 'https://www.bridalnet.co.jp/policy/',
    checkedAt,
  },
  {
    id: 'r50time',
    label: 'R50Time',
    summary: '40〜60代が中心。恋活・婚活・縁活と、相性マッチングや価値観質問を備えた大人世代向け。',
    goals: ['relationship', 'marriage', 'companionship'],
    ageBands: ['40s', '50plus'],
    webAccess: 'available',
    minimumAge: '20歳以上',
    registration: ['メールアドレス'],
    identityStep: '公的身分証による年齢確認が必須',
    strengths: ['会員の7割が40〜50代という公式説明', '恋活・婚活・縁活', 'Web無料登録'],
    cautions: ['50歳未満も登録可能', '外部自動操作の公式許可は未確認'],
    valuesFocus: true,
    seriousFocus: false,
    nativeAutomation: 'none',
    externalAutomationStatus: 'unverified',
    matchPilotConnection: 'prepare',
    officialUrl: 'https://r50time.jp/',
    evidenceUrl: 'https://r50time.jp/',
    termsUrl: 'https://app.r50time.jp/setting/term',
    checkedAt,
  },
  {
    id: 'ange',
    label: 'アンジュ',
    summary: '30歳以上限定。30〜60代の大人世代が、価値観・人柄・好みから真剣な相手を探す恋活・婚活サービス。',
    goals: ['relationship', 'marriage', 'companionship'],
    ageBands: ['30s', '40s', '50plus'],
    webAccess: 'available',
    minimumAge: '30歳以上・独身',
    registration: ['電話番号', 'メールアドレス', 'LINE', 'Google', 'Yahoo! JAPAN ID'],
    identityStep: 'メッセージ前に身分証による年齢確認',
    strengths: ['30歳以上限定', '価値観・人柄検索', '公式Web登録・ログイン'],
    cautions: ['30歳未満は登録不可', '外部自動操作の公式許可は未確認'],
    valuesFocus: true,
    seriousFocus: true,
    nativeAutomation: 'none',
    externalAutomationStatus: 'unverified',
    matchPilotConnection: 'official_only',
    officialUrl: 'https://ange.gift/',
    evidenceUrl: 'https://ange.gift/auth/login',
    termsUrl: 'https://ange.gift/userpolicy/',
    checkedAt,
  },
  {
    id: 'goens',
    label: 'Goens',
    summary: '50歳以上の独身者だけを対象に、恋活・婚活・再婚・友人探しまで扱う50〜60代特化サービス。',
    goals: ['relationship', 'marriage', 'remarriage', 'companionship'],
    ageBands: ['50plus'],
    webAccess: 'app_only',
    minimumAge: '50歳以上・独身',
    registration: ['公式アプリで確認'],
    identityStep: '公的証明書と顔写真による本人確認',
    strengths: ['50歳以上限定', '再婚・友人探しにも対応', 'シンプルな操作'],
    cautions: ['会員向けWeb版を公式確認できずブラウザ自動化対象外', '50歳未満は利用不可'],
    valuesFocus: true,
    seriousFocus: false,
    nativeAutomation: 'none',
    externalAutomationStatus: 'unverified',
    matchPilotConnection: 'official_only',
    officialUrl: 'https://goen-s.com/',
    evidenceUrl: 'https://goen-s.com/help/registration/registration-under-50',
    termsUrl: 'https://goen-s.com/terms-of-service',
    checkedAt,
  },
];

export type ComparisonInput = {
  goal: ComparisonGoal;
  ageBand: ComparisonAgeBand;
  priority: ComparisonPriority;
  browserOnly: boolean;
};

export type RankedJapaneseService = {
  service: JapaneseServiceProfile;
  score: number;
  reasons: string[];
};

export function rankJapaneseServices(input: ComparisonInput): RankedJapaneseService[] {
  return japaneseServiceProfiles
    .map((service) => {
      let score = 0;
      const reasons: string[] = [];
      if (service.goals.includes(input.goal)) {
        score += 46;
        reasons.push(goalReason(input.goal));
      }
      if (service.specialties?.includes(input.goal)) {
        score += 18;
        reasons.push('この目的を公式に重点支援');
      }
      if (service.ageBands.includes(input.ageBand)) {
        score += 26;
        reasons.push(ageReason(input.ageBand));
      }
      if (service.webAccess === 'available') {
        score += 14;
        if (input.browserOnly) reasons.push('ブラウザ利用を公式確認');
      } else if (input.browserOnly) {
        score -= 35;
      }
      if (input.priority === 'least_work' && service.nativeAutomation === 'matching_likes') {
        score += 34;
        reasons.push('公式AIが候補へのいいねを支援');
      }
      if (input.priority === 'values' && service.valuesFocus) {
        score += 24;
        reasons.push('価値観・人柄から探しやすい');
      }
      if (input.priority === 'serious' && service.seriousFocus) {
        score += 24;
        reasons.push('真剣な交際・結婚を重視');
      }
      if (service.externalAutomationStatus === 'prohibited') score -= 8;
      return { service, score, reasons: reasons.slice(0, 4) };
    })
    .sort((a, b) => b.score - a.score || a.service.label.localeCompare(b.service.label, 'ja'));
}

function goalReason(goal: ComparisonGoal) {
  return ({
    relationship: '恋人探しに対応',
    marriage: '結婚を見据えた利用に対応',
    remarriage: '再婚希望に対応',
    companionship: '人生のパートナー・縁活に対応',
  } as const)[goal];
}

function ageReason(ageBand: ComparisonAgeBand) {
  return ({
    '20s': '20代が対象',
    '30s': '30代が対象',
    '40s': '40代が対象',
    '50plus': '50代以上が対象',
  } as const)[ageBand];
}
