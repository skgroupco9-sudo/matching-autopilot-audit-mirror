import type { IdentityProfilePayload } from './identity-types';

export type RegistrationRequirementKey =
  | 'registration_email'
  | 'phone_number'
  | 'legal_name'
  | 'name_kana'
  | 'nickname'
  | 'birth_date'
  | 'gender'
  | 'residence'
  | 'occupation'
  | 'bio'
  | 'face_photo'
  | 'identity_document'
  | 'single_status'
  | 'single_certificate'
  | 'annual_income'
  | 'income_proof'
  | 'tokyo_eligibility'
  | 'marriage_goal'
  | 'service_password';

export type ServiceRegistrationRequirement = {
  id: string;
  label: string;
  fit: 'priority' | 'standard' | 'conditional';
  operation: 'assisted' | 'manual' | 'official_ai';
  loginMethods: string[];
  requirements: RegistrationRequirementKey[];
  note: string;
};

export const registrationRequirementLabels: Record<RegistrationRequirementKey, string> = {
  registration_email: '登録メール',
  phone_number: '本人所有の電話番号',
  legal_name: '公的書類と同じ氏名',
  name_kana: '氏名のフリガナ',
  nickname: 'ニックネーム',
  birth_date: '生年月日',
  gender: '性別',
  residence: '居住地',
  occupation: '職業',
  bio: '自己紹介',
  face_photo: '顔が分かるプロフィール写真',
  identity_document: '本人確認書類',
  single_status: '独身・交際相手なしの確認',
  single_certificate: '独身証明書',
  annual_income: '年収',
  income_proof: '収入証明書',
  tokyo_eligibility: '都内在住・在勤・在学',
  marriage_goal: '婚活目的',
  service_password: 'サービス用パスワード',
};

const common = [
  'registration_email',
  'nickname',
  'birth_date',
  'gender',
  'residence',
  'face_photo',
  'identity_document',
  'single_status',
  'marriage_goal',
  'service_password',
] satisfies RegistrationRequirementKey[];

export const serviceRegistrationRequirements: ServiceRegistrationRequirement[] = [
  {
    id: 'tokyo-enmusubi',
    label: 'TOKYO縁結び',
    fit: 'priority',
    operation: 'manual',
    loginMethods: ['メールアドレス'],
    requirements: ['registration_email', 'phone_number', 'legal_name', 'name_kana', 'birth_date', 'gender', 'residence', 'occupation', 'bio', 'face_photo', 'identity_document', 'single_status', 'single_certificate', 'annual_income', 'income_proof', 'tokyo_eligibility', 'marriage_goal', 'service_password'],
    note: '東京都の本格婚活。独身証明・収入証明・オンライン面談・登録料の確定は本人操作です。',
  },
  { id: 'partners', label: 'パートナーズ', fit: 'priority', operation: 'assisted', loginMethods: ['メールアドレス'], requirements: [...common, 'bio'], note: 'Web登録対応。英数字6〜20文字のパスワードに合わせます。' },
  { id: 'ange', label: 'アンジュ', fit: 'priority', operation: 'manual', loginMethods: ['メールアドレス'], requirements: [...common], note: '30歳以上の独身者向け。登録時の独身確認と規約同意は本人操作です。' },
  { id: 'r50time', label: 'R50Time', fit: 'priority', operation: 'assisted', loginMethods: ['メール', 'LINE', 'Apple'], requirements: [...common, 'phone_number'], note: '50歳以上、または50歳以上との出会いを希望する方が対象です。' },
  { id: 'youbride', label: 'youbride', fit: 'priority', operation: 'assisted', loginMethods: ['メール・ログインID'], requirements: [...common, 'occupation', 'bio', 'annual_income'], note: '30〜40代以上の婚活を優先する候補です。' },
  { id: 'bridalnet', label: 'ブライダルネット', fit: 'priority', operation: 'assisted', loginMethods: ['メールアドレス'], requirements: [...common, 'legal_name', 'occupation', 'bio', 'annual_income'], note: '顔写真・本人確認・有料会員確認が必要です。購入確定は本人操作です。' },
  { id: 'match', label: 'Match', fit: 'priority', operation: 'assisted', loginMethods: ['メールアドレス'], requirements: [...common, 'occupation', 'bio', 'annual_income'], note: '顔写真を登録してから準備します。' },
  { id: 'couplink', label: 'CoupLink', fit: 'standard', operation: 'manual', loginMethods: ['メール', '電話番号', 'Apple'], requirements: [...common, 'phone_number', 'bio'], note: 'Web登録対応。年齢確認と最終送信は本人操作です。' },
  { id: 'ciel', label: 'Ciel', fit: 'standard', operation: 'assisted', loginMethods: ['メール', 'Facebook'], requirements: [...common, 'bio'], note: '登録時に本人確認書類の確認があります。' },
  { id: 'hanamel', label: 'ハナメル', fit: 'standard', operation: 'manual', loginMethods: ['電話番号', 'メール', 'Google', 'LINE', 'Apple'], requirements: [...common, 'phone_number'], note: '30歳以上向け。パスワードは公式仕様に合わせた数字4桁です。' },
  { id: 'aikata', label: 'aikata', fit: 'standard', operation: 'manual', loginMethods: ['電話番号', 'Google', 'LINE', 'Apple'], requirements: [...common, 'phone_number', 'bio'], note: '30〜50代中心。会話から関係を育てるタイプです。' },
  { id: 'duo', label: 'Duo', fit: 'conditional', operation: 'manual', loginMethods: ['メールアドレス'], requirements: [...common], note: 'Web完結型。婚活の真剣度は相手プロフィールで個別確認します。' },
  { id: 'ravit', label: 'Ravit', fit: 'priority', operation: 'official_ai', loginMethods: ['公式画面で選択'], requirements: [...common, 'bio'], note: '公式AIエージェントを優先し、外部からの自動操作は行いません。' },
  { id: 'pairs', label: 'Pairs', fit: 'priority', operation: 'manual', loginMethods: ['LINE', 'Apple', 'Google', '電話番号・メール'], requirements: [...common, 'bio'], note: 'NEWまたは今週入会の条件確認を追加します。' },
  { id: 'with', label: 'with', fit: 'priority', operation: 'manual', loginMethods: ['LINE', '電話番号', 'Apple'], requirements: [...common, 'phone_number', 'bio'], note: '1人1アカウント。公式Web機能と手動操作だけを使用します。' },
  { id: 'marrish', label: 'marrish', fit: 'priority', operation: 'manual', loginMethods: ['電話番号', 'メール', 'LINE', 'Apple', 'Amazon'], requirements: [...common, 'phone_number', 'bio'], note: '再婚・真剣交際候補。公式Web機能と手動操作だけを使用します。' },
  { id: 'pcmax', label: 'PCMAX', fit: 'conditional', operation: 'assisted', loginMethods: ['メール', '電話番号', 'Google', 'Yahoo! JAPAN'], requirements: [...common, 'phone_number'], note: '婚活意思・年収・職業を会話で必ず確認する条件付き候補です。' },
];

export type RegistrationReadinessInput = IdentityProfilePayload['profile'] & {
  hasFacePhoto: boolean;
  hasIdentityDocument: boolean;
  credentialServiceKeys: Set<string>;
};

export function getServiceRegistrationReadiness(service: ServiceRegistrationRequirement, input: RegistrationReadinessInput) {
  const ready = (key: RegistrationRequirementKey) => {
    switch (key) {
      case 'registration_email': return Boolean(input.registrationEmail);
      case 'phone_number': return Boolean(input.phoneNumber && input.phoneOwnershipConfirmed);
      case 'legal_name': return Boolean(input.legalName);
      case 'name_kana': return Boolean(input.nameKana);
      case 'nickname': return Boolean(input.nickname);
      case 'birth_date': return Boolean(input.birthDate);
      case 'gender': return Boolean(input.gender);
      case 'residence': return Boolean(input.residence);
      case 'occupation': return Boolean(input.occupation);
      case 'bio': return Boolean(input.bio);
      case 'face_photo': return input.hasFacePhoto;
      case 'identity_document': return input.hasIdentityDocument;
      case 'single_status': return input.singleStatusConfirmed;
      case 'single_certificate': return input.singleCertificateStatus === 'ready';
      case 'annual_income': return Boolean(input.annualIncome);
      case 'income_proof': return input.incomeProofStatus === 'ready';
      case 'tokyo_eligibility': return ['resident', 'worker', 'student'].includes(input.tokyoEligibility);
      case 'marriage_goal': return input.relationshipGoal === 'marriage';
      case 'service_password': return input.credentialServiceKeys.has(service.id);
    }
  };
  const missing = service.requirements.filter((requirement) => !ready(requirement));
  return { ready: service.requirements.length - missing.length, total: service.requirements.length, missing, complete: missing.length === 0 };
}
