# MatchPilot

複数のマッチングサービスをスマートフォンとPCから管理する、個人用ブラウザ自動化コントロールプレーンです。管理画面はクラウド、ログイン済みChromeは手元の常時稼働ワーカーに置く分離構成です。OpenAI APIキーはクラウド側で暗号化し、本人に紐づく専用ワーカーだけへ一時提供します。

## 本番監査ステータス（2026-08-28）

- ブラウザワーカーの常駐、1分ごとの復旧監視、heartbeatは確認済み。
- 公開カタログとブラウザ接続候補は実装済みだが、実サービス接続は0件。
- OpenAIの暗号化キーと`gpt-5.6-luna`を設定し、Responses APIのHTTP 200応答を確認済み。設定画面と総合セルフテストから再診断できます。
- Telegram報告と暗号化バックアップは接続確認済み。Gmail OAuth、Telegram 2段階認証、本人情報の必須項目は利用者の最終設定待ち。
- 実サービスで「ログイン → 候補取得 → いいね → マッチ検出 → 返信送信 → LINE受領後のTelegram報告」を完走したE2E実績は0/6段階。

管理画面の「全自動診断」は、設定状態と実サービス完走実績を分けて表示します。接続候補数を実機検証済み件数として扱いません。参照した既存システム・類似製品・公式技術資料・サービス調査URLは`/sources`で公開します。

## 実装済み

- メールアドレス・パスワードと30日セッションによるレスポンシブ管理画面。本人確認付きパスワード変更で他端末セッションを失効
- 管理者専用のアカウント一覧、72時間の一回限り招待、利用停止・再開、即時セッション失効
- D1への接続・候補・会話・メッセージ・ルール・ジョブ・報告の永続化
- 90秒リース、最大5回の指数バックオフ、ワーカー所有権検証、二重送信防止ジャーナル
- 年齢・距離・許可テーマ・禁止テーマ・最低確信度・運転モードの指定
- 新規アプローチを1アプリ・日本時間1日5人までに制限
- OpenAI Responses API + Structured Outputsによる返信案と、秘密値を表示しない実接続診断
- 過去12件の会話と本人が承認した送信文を次回生成へ渡す継続的な文体適応
- 条件達成・低確信度・手動確認をTelegramへ要約、プロフィールURL、スクリーンショット付きで報告
- 日本時間の毎日21時に、いいね・マッチ・進行中会話・判断待ち・条件達成をTelegramへ冪等送信
- Telegram上で返信案を承認・取消
- Telegramへ選択送信した報告例・NGを個人情報除去後に分類し、二段階承認で次回の報告形式へ反映
- 監査ログ表示と、個人データ一式のJSONエクスポート
- Stripe Checkout、契約同期Webhook、顧客ポータルによるサブスク管理
- 31件のブラウザ接続候補から最大5件まとめて登録・ログイン準備
- 公式Web版、登録方法、最低準備項目、利用規約を一覧化したサービスカタログ
- 個人版の返信案・ルール・接続準備はアプリ内クレジット消費なし
- 登録用メール、本人所有の電話番号、ニックネーム、生年月日、居住地、職業、自己紹介を暗号化保存する登録情報ハブ
- Gmail OAuthの読み取り専用権限で直近の認証コード候補だけを取得し、メール本文を保存せず登録画面へ入力準備

Tinderはロボット等の自動アクセスを規約で禁止しているため一覧と公式ページ導線のみです。Bumbleは公式案内でアプリ専用へ移行済みのためブラウザ接続対象外です。タップルとD³ / Dineも操作可能な会員向けWeb版を公式確認できないため対象外です。

## 安全境界

初回登録の入力準備と、本人が許可したGmail認証コードの入力欄への反映を補助します。写真提出、SMS受信、CAPTCHA、年齢・本人確認、規約同意、認証コード送信、アカウント作成確定は自動突破しません。全自動モードでは、本人が接続したサービスに限り、属性・会話ルール・確信度・1日5人の上限を満たすいいねと返信送信を自動実行します。日程確定、連絡先交換、高リスク話題、低確信度、CAPTCHA、OTP、本人確認では停止して本人へ確認します。共通プロフィールと本人が明示保存したサービス認証情報はAES-256-GCMで暗号化します。OTPとGmail本文は保存せず、身分証・プロフィール画像は暗号化してR2へ保存します。

## 必要な本番設定

コントロールプレーン側:

```env
WORKER_SHARED_SECRET=十分に長いランダム値
MATCHPILOT_SETUP_SECRET=初回アカウント作成リンク用の十分に長いランダム値
MATCHPILOT_SESSION_SECRET=セッション署名用の十分に長いランダム値
MATCHPILOT_ADMIN_EMAIL=初回管理者として登録を許可するメールアドレス
TELEGRAM_BOT_TOKEN=BotFatherで発行した値
TELEGRAM_WEBHOOK_SECRET=Telegram webhook検証用のランダム値
TELEGRAM_BOT_USERNAME=先頭の@を除いたBot名
STRIPE_SECRET_KEY=Stripeのサーバー用秘密鍵
STRIPE_WEBHOOK_SECRET=Stripe webhookの署名シークレット
STRIPE_PRICE_ID=月額または年額PriceのID
STRIPE_BILLING_ENABLED=false
STRIPE_PLAN_NAME=MatchPilot Pro
IDENTITY_VAULT_ENCRYPTION_KEY=32バイトのbase64url値
GOOGLE_CLIENT_ID=Google Cloudのウェブアプリ用OAuthクライアントID
GOOGLE_CLIENT_SECRET=Google Cloudのウェブアプリ用OAuthクライアントシークレット
```

1. `.openai/hosting.json` の `DB` と `FILES` をD1/R2へ接続する。
2. `drizzle/0000` から番号順に全SQLをD1へ適用する。
3. 上記の秘密値を本番環境へ設定する。
4. Telegram Bot APIのwebhookを `https://<本番URL>/api/telegram/webhook` に設定し、`secret_token` に `TELEGRAM_WEBHOOK_SECRET` と同じ値を指定する。
5. `#setup=<MATCHPILOT_SETUP_SECRET>` を付けた本人専用URLを一度だけ開き、`MATCHPILOT_ADMIN_EMAIL` と8文字以上のパスワードを登録する。
6. サイトへログインし、設定画面から `WORKER_USER_ID` をコピーする。
7. [worker/README.md](worker/README.md) に沿って常時稼働PCでワーカーを起動する。
8. 管理画面からサービスを追加し、開いたChromeで初回ログイン・本人確認を手動完了する。
9. Telegramを接続し、「確認優先」で返信案・スクリーンショット・達成報告を受け取る。

## Gmail認証コード連携

1. Google CloudでGmail APIを有効化し、ウェブアプリ用OAuthクライアントを作成する。
2. 承認済みリダイレクトURIへ `https://<本番URL>/api/integrations/gmail/callback` を完全一致で登録する。
3. `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を本番の秘密値として設定する。
4. OAuth同意画面で利用者をテストユーザーへ追加し、登録情報ハブからGmailを接続する。
5. Googleの `gmail.readonly` は制限付きスコープのため、第三者へ広く提供する場合はGoogleのOAuth確認・必要なセキュリティ評価を完了する。

MatchPilotはアクセストークンを保存せず、更新トークンだけをAES-256-GCMで暗号化します。認証メールは直近15分・最大10件に絞り、抽出した番号をDBや監査ログへ保存しません。

管理者は設定画面の「管理者ページ」から登録済みアカウントを確認し、新しいユーザー向けの招待リンクを発行できます。管理ページとAPIにはパスワード、認証トークン、会話本文、マッチ相手の個人情報を返しません。

## Stripeサブスクを開始する手順

1. Stripeのサンドボックスで継続課金ProductとPriceを作成する。
2. Webhook送信先を `https://<本番URL>/api/billing/webhook` にし、`checkout.session.completed`、`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`、`invoice.paid`、`invoice.payment_failed` を登録する。
3. サンドボックスの秘密鍵、Webhook署名シークレット、Price IDを本番環境へ設定する。
4. Checkout、更新、支払い失敗、解約、顧客ポータルをサンドボックスで確認する。
5. 本番用の値へ切り替え、最後に `STRIPE_BILLING_ENABLED=true` として申込みを有効化する。

`STRIPE_BILLING_ENABLED=false` の間は決済APIを呼ばず、請求は発生しません。カード番号はMatchPilotのDBへ保存せず、Stripe Checkoutと顧客ポータルだけで扱います。

## ローカル検証

```powershell
pnpm db:generate
pnpm lint
pnpm build
cd worker
node --check src/index.mjs
```

## ワーカー用HTTP契約

- `POST /api/worker/heartbeat`: 稼働状態と全体停止状態を同期
- `GET /api/worker/jobs?user_id=...`: 次のジョブを90秒リース
- `POST /api/worker/jobs`: 成功・失敗・再試行を報告し、メッセージ状態を確定
- `POST /api/worker/events`: 候補、会話、条件達成、確認待ちを冪等に同期
- `POST /api/worker/screenshots`: 最大10MBのPNG/JPEG/WebPをR2へ保存
- `POST /api/worker/daily-summary`: 1日1回のTelegramサマリーを冪等送信
- `GET /api/worker/identity?user_id=...`: 本人が許可した登録用プロフィールをワーカーへ一時提供
- `POST /api/worker/identity/codes`: Gmailから直近の認証コード候補を一時提供
- `POST /api/telegram/webhook`: 一回限りの接続トークンと承認・取消を処理
- `GET/POST /api/telegram-learning`: 報告例・NGの確認、分類、反映、削除

ワーカーAPIは `Authorization: Bearer <WORKER_SHARED_SECRET>`、`x-worker-id`、120秒以内のheartbeatを要求します。
