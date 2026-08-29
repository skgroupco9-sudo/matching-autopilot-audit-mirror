export const SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER = 3;
export const SAFE_ACTIVE_CONVERSATION_LIMIT_PER_PROVIDER = 10;
export const MINIMUM_MESSAGES_BEFORE_HUMAN_CONTACT_REVIEW = 5;

export const fixedOperationalSafeguards = [
  {
    id: 'single_account',
    title: '1サービス1アカウント',
    detail: '既存アカウントがある場合は新規作成せず、公式のログイン・復旧・サポートを使用します。',
  },
  {
    id: 'daily_limit',
    title: `新規候補は1日${SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER}人まで`,
    detail: 'サービス単位の保守的な上限です。上限到達後は翌日まで自動処理を停止します。',
  },
  {
    id: 'active_limit',
    title: `同時に確認する会話は${SAFE_ACTIVE_CONVERSATION_LIMIT_PER_PROVIDER}件まで`,
    detail: '返信待ちを含む会話が増えすぎた場合は、新規候補より既存会話の確認を優先します。',
  },
  {
    id: 'contact_receive_only',
    title: '外部連絡先は原則受領のみ',
    detail: '禁止・不明なサービスでは要求せず、公式に許可された導線だけ本人確認後の承認対象にします。',
  },
  {
    id: 'live_identity',
    title: '本人確認は本人のライブ操作',
    detail: '写真・動画・他端末表示による認証回避は行わず、公式画面で本人が完了します。',
  },
  {
    id: 'restriction_stop',
    title: '制限を検知したら即停止',
    detail: '利用停止・追加認証・異常画面では操作を継続せず、証跡を添えてTelegramへ報告します。',
  },
] as const;

export const prohibitedEvasionMethods = [
  '禁止語を隠語・伏字・類似文字へ変えて送信する',
  '複数アカウント、端末初期化、別IDで利用制限を回避する',
  '画像や別端末を使って顔認証・本人確認を回避する',
  'サービスのスクリーンショット制限を迂回する',
] as const;
