export type ReferenceSource = {
  name: string;
  organization: string;
  url?: string;
  adopted: string;
  boundary?: string;
};

export const internalReferenceSources: ReferenceSource[] = [
  {
    name: 'Group Tidy（休眠Telegramグループ整理）',
    organization: 'このワークスペース内の既存システム',
    adopted: '再開可能キュー、操作直前の再検証、レート制限待機、暗号化監査ログ、多重起動防止をブラウザワーカー設計へ反映。',
    boundary: '元システムの削除操作やTelegram認証セッションは流用せず、設計パターンだけを採用。',
  },
  {
    name: 'MAIL ORBIT（複数Gmail管理）',
    organization: 'このワークスペース内の既存システム',
    adopted: 'Google OAuthのサーバー側フロー、利用者単位のデータ分離、更新トークン暗号化をGmail認証番号補助へ反映。',
    boundary: 'メール本文は保存せず、本人が許可した直近の認証番号候補だけを一時利用。',
  },
  {
    name: 'Esteman 備品発注・監視システム',
    organization: 'このワークスペース内の既存システム',
    adopted: '外部サービスへ確定前の下書きを渡す方式、承認状態、監視・再試行・CSV/JSON監査の考え方を採用。',
    boundary: 'Amazon・店舗データ・管理者キーはMatchPilotへ持ち込まない。',
  },
  {
    name: 'MatchPilot 既存実装',
    organization: 'このワークスペース内の現行システム',
    adopted: '90秒ジョブリース、指数バックオフ、二重送信防止、1サービス1日5人上限、ルール判定、Telegram報告を継続利用。',
    boundary: '表示件数と実機検証を分離し、未接続・未検証を「対応済み」と表現しない。',
  },
];

export const similarProductSources: ReferenceSource[] = [
  {
    name: 'YourMove AI',
    organization: 'YourMove AI',
    url: 'https://www.yourmove.ai/',
    adopted: 'プロフィール改善、スクリーンショット起点の会話文脈、複数返信候補という利用者負担の減らし方を比較。',
    boundary: 'マーケティング上の効果数値は検証済み事実として採用しない。MatchPilotは実送信可否を別途診断する。',
  },
  {
    name: 'RIZZ',
    organization: 'RIZZ LABS LLC',
    url: 'https://web.rizz.app/',
    adopted: '任意アプリのスクリーンショットから文脈を読み、本人の表現へ寄せる会話支援UXを比較。',
    boundary: 'MatchPilotは無断な人格代行を目標にせず、禁止話題・確信度・エスカレーションを優先。',
  },
  {
    name: 'ROAST',
    organization: 'ROAST',
    url: 'https://roast.dating/',
    adopted: 'プロフィール、写真、自己紹介を一度整え、複数サービスで再利用する登録情報ハブの参考。',
    boundary: '写真評価や成果保証は実装せず、本人が選んだ情報の安全な再利用に限定。',
  },
];

export const japanServiceResearchSources: ReferenceSource[] = [
  {
    name: 'Ravit AIエージェント',
    organization: '株式会社フィラメント',
    url: 'https://support.ravit.jp/hc/ja/articles/900000954846-AI%E3%82%A8%E3%82%B8%E3%82%A7%E3%83%B3%E3%83%88',
    adopted: '公式AIが相性のよい相手へ無料いいねを送ること、利用者自身のいいねと区別表示されることを「手間の少なさ」の比較項目へ反映。',
    boundary: '公式AI機能を外部自動操作の許可とは解釈せず、Ravit内の公式機能だけを優先。',
  },
  {
    name: 'with 公式サイト・利用規約',
    organization: '株式会社with',
    url: 'https://with.is/terms_of_use',
    adopted: '価値観診断、好みカード、Web登録方法、18歳以上・独身・本人確認必須を比較へ反映。',
    boundary: '自動投稿・巡回ツール等の使用禁止を確認し、外部自動操作対象から除外。',
  },
  {
    name: 'Omiai ブラウザ版・利用規約',
    organization: '株式会社Omiai',
    url: 'https://fb.omiai-jp.com/japan/site/kiyaku/',
    adopted: '真剣な恋愛・結婚目的、ブラウザ版、LINE・電話番号等の認証方法を比較へ反映。',
    boundary: '自動投稿・巡回ツールの禁止を確認し、外部自動操作対象から除外。',
  },
  {
    name: 'marrish 公式サイト・登録ヘルプ・利用規約',
    organization: '株式会社マリッシュ',
    url: 'https://marrish.com/auth/userpolicy',
    adopted: '再婚・シンママ・シンパパ・中年婚、Web版、メール／電話／LINE等の登録方法を比較へ反映。',
    boundary: '投稿コンテンツの自動収集・解析禁止を確認し、外部自動操作対象から除外。',
  },
  {
    name: 'Pairs 本人確認ヘルプ',
    organization: '株式会社エウレカ',
    url: 'https://support.pairs.lv/hc/ja/articles/115007254088-%E6%9C%AC%E4%BA%BA%E7%A2%BA%E8%AA%8D%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6',
    adopted: '18歳以上と複数アカウントの有無を本人確認する仕様、本人確認後に使える機能を比較へ反映。',
    boundary: '外部自動操作の公式許可を確認できていないため、公式入口と比較情報に限定。',
  },
  {
    name: 'Pairs 複数アカウント・安全対策ヘルプ',
    organization: '株式会社エウレカ',
    url: 'https://support.pairs.lv/hc/ja/articles/39869282220313-%E8%A4%87%E6%95%B0%E3%81%AE%E3%82%A2%E3%82%AB%E3%82%A6%E3%83%B3%E3%83%88%E3%82%92%E7%99%BB%E9%8C%B2%E3%81%97%E3%81%A6%E3%81%97%E3%81%BE%E3%81%A3%E3%81%9F',
    adopted: '複数アカウントが禁止され、ログイン・利用制限の対象になり得ることを確認し、1サービス1アカウントをDBと登録APIの両方で固定。',
    boundary: '既存接続がある場合は新規登録を再実行せず、既存アカウントの再ログインへ誘導。',
  },
  {
    name: 'Pairs 安心・安全への取り組み',
    organization: '株式会社エウレカ',
    url: 'https://pairs.lv/static/safety/activity/works_on_safety',
    adopted: '24時間365日の監視と規約違反時の警告・強制退会を前提に、異常時の接続停止と操作予約取消を追加。',
    boundary: '監視判定を回避する機能は実装しない。',
  },
  {
    name: 'youbride 公式サイト・利用ガイド',
    organization: '株式会社サンマリエ',
    url: 'https://youbride.jp/guide/',
    adopted: '30〜40代以上中心、婚活・再婚、Web利用、年齢確認と有料メッセージ条件を比較へ反映。',
    boundary: '外部自動操作が公式に許可されたとは表示しない。',
  },
  {
    name: 'ブライダルネット 公式サイト・本人認証',
    organization: '株式会社IBJ',
    url: 'https://www.bridalnet.co.jp/safe/auth.html',
    adopted: '20歳以上、男性の定職要件、電話認証、公的証明書確認、日記・紹介機能を比較へ反映。',
    boundary: '外部自動操作が公式に許可されたとは表示しない。',
  },
  {
    name: 'R50Time 公式サイト',
    organization: '株式会社セカンドタイム',
    url: 'https://r50time.jp/',
    adopted: '40〜60代中心、恋活・婚活・縁活、20歳以上、公的身分証必須、Web無料登録を比較へ反映。',
    boundary: '外部自動操作が公式に許可されたとは表示しない。',
  },
  {
    name: 'アンジュ 公式サイト・Webログイン',
    organization: '株式会社アンジュ',
    url: 'https://ange.gift/',
    adopted: '30歳以上限定、価値観・人柄検索、Web登録・ログイン、複数の認証方法を比較へ反映。',
    boundary: '外部自動操作が公式に許可されたとは表示しない。',
  },
  {
    name: 'Goens 公式サイト・登録条件',
    organization: 'Goens株式会社',
    url: 'https://goen-s.com/help/registration/registration-under-50',
    adopted: '50歳以上限定、恋活・婚活・再婚・友人探し、公的証明書と顔写真の本人確認を比較へ反映。',
    boundary: '会員向けWeb版を確認できないため、ブラウザ操作対象から除外。',
  },
  {
    name: 'Tinder 利用規約',
    organization: 'Match Group, LLC',
    url: 'https://tinder.com/terms/intl/ja/',
    adopted: '1人1アカウント、正確な本人情報、アカウント共有禁止、ロボット・クローラー・無許可API/AI連携禁止を保護基準へ反映。',
    boundary: '第三者AI/自動操作の書面許可がないため、外部自動操作対象にしない。停止後の別アカウント作成もしない。',
  },
  {
    name: 'Tinder コミュニティガイドライン',
    organization: 'Match Group, LLC',
    url: 'https://tinder.com/community-guidelines/intl/ja/',
    adopted: '1人1アカウント、大量アカウント・誤解を招く情報・望まれない外部リンクの禁止を登録と送信の保護基準へ反映。',
    boundary: 'アカウント量産、外部リンク連投、機能制限を解除する第三者技術は実装しない。',
  },
];

export const engineeringReferenceSources: ReferenceSource[] = [
  {
    name: 'Playwright Authentication',
    organization: 'Microsoft / Playwright',
    url: 'https://playwright.dev/docs/auth',
    adopted: 'ログイン済みブラウザ状態をローカルに隔離し、リポジトリやクラウドDBへ保存しない原則。',
  },
  {
    name: 'Playwright Browser Contexts',
    organization: 'Microsoft / Playwright',
    url: 'https://playwright.dev/docs/browser-contexts',
    adopted: 'サービス接続ごとのセッション分離と、相互汚染を避けるテスト設計。',
  },
  {
    name: 'Stagehand Agent',
    organization: 'Browserbase',
    url: 'https://docs.stagehand.dev/v3/basics/agent',
    adopted: 'DOM変更に強い観察・実行分離を比較対象にし、曖昧なボタンは押さない方針を採用。',
    boundary: 'ボット検知やCAPTCHAの回避用途には使わない。',
  },
  {
    name: 'Temporal Workflows',
    organization: 'Temporal Technologies',
    url: 'https://docs.temporal.io/workflows',
    adopted: '長時間処理を小さな再開可能ステップに分ける設計を、D1ジョブリースと再試行へ反映。',
  },
  {
    name: 'LangGraph Persistence / Interrupts',
    organization: 'LangChain',
    url: 'https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/breakpoints/',
    adopted: '状態を保存して本人判断で再開するチェックポイント設計をTelegram承認へ反映。',
  },
  {
    name: 'OpenAI Structured Outputs',
    organization: 'OpenAI',
    url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
    adopted: '返信、話題、確信度、エスカレーション理由をJSON Schemaで固定し、自由文の解析失敗を減らす。',
  },
  {
    name: 'Telegram Bot API',
    organization: 'Telegram',
    url: 'https://core.telegram.org/bots/api',
    adopted: 'テキスト、画像、インラインボタンを使った達成報告と承認導線。',
  },
  {
    name: 'Gmail API server-side authorization',
    organization: 'Google',
    url: 'https://developers.google.com/workspace/gmail/api/auth/web-server',
    adopted: '利用者同意、更新トークン、サーバー側OAuthコールバックの標準フロー。',
  },
  {
    name: 'Gmail API scopes',
    organization: 'Google',
    url: 'https://developers.google.com/workspace/gmail/api/auth/scopes',
    adopted: '必要最小限の読み取り権限と、公開前のOAuth確認要件。',
  },
  {
    name: 'Stripe subscription webhooks',
    organization: 'Stripe',
    url: 'https://docs.stripe.com/billing/subscriptions/webhooks',
    adopted: '契約状態をブラウザ結果ではなく署名付きWebhookで確定する課金設計。',
  },
  {
    name: 'WCAG 2.2',
    organization: 'W3C',
    url: 'https://www.w3.org/TR/WCAG22/',
    adopted: 'キーボード操作、フォーカス表示、44px級タップ領域、状態の文字併記をUI監査基準に使用。',
  },
  {
    name: 'OWASP ASVS',
    organization: 'OWASP Foundation',
    url: 'https://owasp.org/www-project-application-security-verification-standard/',
    adopted: '認証、セッション、アクセス制御、秘密情報、監査ログのセキュリティ確認項目として使用。',
  },
];
