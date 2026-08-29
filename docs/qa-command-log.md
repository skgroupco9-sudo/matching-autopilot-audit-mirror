# MatchPilot Personal QA command log

実行日: 2026-08-29 (Asia/Tokyo)

秘密値は出力していない。以下は最終確認時の ANSI 制御文字を除いた端末出力である。

## Repository evidence

```text
> git branch --show-current
feature/qa-audit-2026

> git rev-parse HEAD
2083fdf7052dffd6fc4a75d2972e0af37f69f51f

> git rev-parse bbdeae59c9b3ae26ee74187de55dcb9c2c7558a2
bbdeae59c9b3ae26ee74187de55dcb9c2c7558a2

> git remote -v
origin  https://github.com/skgroupco9-sudo/matching-autopilot.git (fetch)
origin  https://github.com/skgroupco9-sudo/matching-autopilot.git (push)

> git diff --stat bbdeae59c9b3ae26ee74187de55dcb9c2c7558a2
46 files changed, 1700 insertions(+), 186 deletions(-)

> git diff --check
[no output]
```

## Secret and dependency audit

```text
> git check-ignore -v .env .env.local sample.key secrets/example.txt
.gitignore:32:.env*       .env
.gitignore:32:.env*       .env.local
.gitignore:22:*.key       sample.key
.gitignore:23:secrets/    secrets/example.txt

> git log --all --full-history --format='%H %s' -- '*.env' '*secret*' '*key*'
[no matches]

> git ls-files --cached --ignored --exclude-standard
[no matches]

> rg -n -i '(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN ... PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,})' ...
[no matches]

> pnpm audit --prod
No known vulnerabilities found
```

## Full static, unit, integration and worker check

```text
> pnpm check
$ tsc --noEmit
$ eslint . --ignore-pattern dist --ignore-pattern .next --ignore-pattern outputs --ignore-pattern work
$ node --experimental-strip-types --test test/security-foundations.test.mjs
✔ password hashing stays within the production Web Crypto limit
✔ worker identifiers accept only bounded safe values
✔ worker binding tokens require 256-bit lowercase hex
✔ worker tokens are stored as deterministic SHA-256 hashes
✔ browser mutation rejects cross-site requests and wrong JSON media types
✔ every mutation route has a browser-origin or signed-machine boundary
tests 6; pass 6; fail 0

$ node --experimental-strip-types --test test/qa-fuzz.test.mjs
✔ 10,000 hostile and Unicode inputs remain bounded and well-formed
✔ client API calls use the timeout and single-flight guard
✔ React pages contain no user-controlled raw HTML sink
✔ every editable text control has an explicit client-side length limit
tests 4; pass 4; fail 0

$ node --experimental-strip-types --test test/telegram-learning.test.mjs
✔ Telegram学習文は個人情報と認証情報を保存前に伏せる
✔ LINE ID・氏名・住所の表記ゆれも学習前に伏せる
✔ 承認した良い例の箇条書き書式を報告へ反映する
✔ NGは通常項目へ反映し、安全上必要な警告は残す
✔ 学習NGにブロック語が含まれても36〜48時間の運用記録は削除しない
✔ 会話例はTelegram報告の本文を書き換えない
✔ Telegram Bot表示名を安全な64文字以内へ正規化する
✔ Telegram Desktop JSONの文字列と装飾配列を匿名化して取り込む
✔ 複数チャットを含むTelegram書き出しにも対応する
✔ 貼り付け文章は段落単位で分割し同じ内容を安定して重複判定する
✔ 画像解析結果は文字列だけを匿名化し上限内に整える
✔ Telegram履歴取込は一回500件に制限する
✔ Telegram学習候補はD1のバインド上限内で小分け保存する
✔ Telegram装飾テキストの再帰的な結合を行う
✔ GPT全件解析は許可したIDを一度ずつ安全な用途へ分類する
✔ GPT分類は欠落しにくい小分け単位で処理する
✔ GPT統合プロファイルは個人情報を再度匿名化する
✔ 会話学習は敬語だけを採用し業務連絡とプロンプト注入を除外する
tests 18; pass 18; fail 0

$ node --experimental-strip-types --test test/service-comparison.test.mjs
✔ 手間の少なさでは公式AIいいねを持つRavitを優先する
✔ 40代の再婚希望ではmarrishを最上位にする
✔ ブラウザ優先時はアプリ専用のGoensを上位3件から外す
tests 3; pass 3; fail 0

$ node --experimental-strip-types --test test/identity-documents.test.mjs
✔ 本人確認書類の許可形式を実データの署名で判定する
✔ iPhoneのHEIC画像を受け付ける
✔ 書類種別・面・有効期限を許可リストで検証する
✔ 保存上限を端末写真向けの安全な範囲に固定する
tests 4; pass 4; fail 0

$ node --experimental-strip-types --test test/identity-profile-fields.test.mjs test/identity-profile-photos.test.mjs
✔ 再利用プロフィールの身長と選択肢を許可リストで検証する
✔ テキストと登録要件を正規化し、破損JSONは安全な空プロフィールへ戻す
✔ 本人確認用氏名は外部ワーカーへ渡さない
✔ プロフィール写真は実データの署名でJPEG・PNG・WebPだけを受け付ける
✔ 用途・説明・保存上限を固定する
tests 5; pass 5; fail 0

$ node --experimental-strip-types --test test/service-credentials.test.mjs
✔ 既知サービスとカスタムサービスのキーだけを受け付ける
✔ サービス名とログインIDを正規化する
✔ サービス用パスワードを8〜128文字に制限する
✔ サービス固有のパスワード仕様を検証する
✔ 保管数を全サービス向けの上限に固定する
✔ 一括登録用パスワードはサービスごとに強く一意に生成する
tests 6; pass 6; fail 0

$ node --experimental-strip-types --test test/service-registration-requirements.test.mjs
✔ 17サービスを登録要件として管理する
✔ TOKYO縁結びは証明書と都内条件を不足として検出する
✔ 回答・顔写真・個別パスワードがそろうと要件へ反映する
tests 3; pass 3; fail 0

$ node --experimental-strip-types --test test/ai-credentials.test.mjs
✔ OpenAI APIキーは秘密値として扱える安全な形式だけを受け付ける
✔ モデル名と表示用ヒントを安全な範囲へ正規化する
✔ OpenAI実接続診断は秘密値を返さず正常応答を判定する
✔ OpenAI実接続診断は請求・権限・モデルエラーを安全な分類へ変換する
tests 4; pass 4; fail 0

$ node --experimental-strip-types --test test/automation-story.test.mjs
✔ LINE ID・招待URL・QRコードを受領情報として抽出する
✔ LINE受領報告を固定フォーマットへ変換する
✔ LINE受領だけでは婚活意思未確認のため達成扱いにしない
✔ 外部連絡先は直接語・隠語とも送信せず受信だけを判定する
✔ サービス一覧と登録準備は推奨・条件付き・禁止ルールを共有する
✔ 婚活候補は年齢・年収・職業・アプリ条件をすべて満たす
✔ いいね数がない・非表示・測定不能なアプリは候補から除外しない
✔ 過去獲得者は表記ゆれを吸収してアプリ横断で照合する
tests 8; pass 8; fail 0

$ node --experimental-strip-types --test test/automation-operations.test.mjs
✔ 正規運用ガードは保守的な上限と回避禁止を固定する
✔ 初回の自動返信はすぐ送信待ちにする
✔ 直前の返信から2分空けて連投を防ぐ
✔ 送信待ちがある会話では返信を重ねない
✔ 会話ごとの1日上限に達したら自動送信を止める
✔ スクリーンショットの保持期限は30日
✔ スクリーンショット保存先は利用者ごとに安全な接頭辞へ分離する
✔ 暗号化バックアップは利用者ごとに分離し直近7回を保持する
✔ Telegram認証コードは6桁・10分・最大5回に制限する
✔ LINE受領後のブロックは36〜48時間の範囲だけ許可する
✔ 別の相手への同一文面は表記ゆれを正規化して24時間保留にできる
✔ 外部操作の最終失敗だけを接続停止対象として分類する
✔ 安全診断は内部必須項目と実地確認を分離する
tests 13; pass 13; fail 0

> pnpm --dir worker check
✔ 31件の公開Web入口をHTTPS許可リストで受け付ける
✔ 別サービス・偽装サブドメイン・HTTPを拒否する
✔ 正規サービスのサブドメインだけを許可する
✔ 禁止または許可未確認のサービスは外部巡回・送信へ進めない
✔ 登録パスワード補助は入力だけ行い送信やクリックを実行しない
✔ 利用停止・凍結表示は自動操作の停止条件として検知する
✔ ブロック操作は曖昧な候補をクリックせず確認ダイアログも一意に限定する
✔ GPT返信生成へ履歴全体の会話スタイルを主軸情報として渡す
✔ 同一文面は一度だけ作り直し、それでも危険なら安全停止する
✔ 直接語や隠語が二回続いた場合は自動送信せず停止する
✔ control-plane requests include both deployment and user-scoped worker credentials
✔ registration photo download stays user-scoped and returns image bytes
✔ AI settings stay user-scoped and never place credentials in the URL
✔ AIキーがないワーカーは返信生成を申告せずdegradedになる
✔ AIキーがあるワーカーだけ返信生成能力を申告する
✔ 停止heartbeatは不足設定より優先される
tests 16; pass 16; fail 0

process exit code: 0
```

上記の Node test は合計 90/90 PASS（6+4+18+3+4+5+6+3+4+8+13+16）。型検査と ESLint も終了コード 0。

## E2E on Cloudflare preview

```text
> PLAYWRIGHT_BASE_URL=http://localhost:3001 playwright test tests/e2e/auth-resilience.spec.ts
Running 16 tests using 1 worker
ok desktop malicious strings never execute as HTML or JavaScript
ok desktop twenty rapid submissions produce one network mutation
ok desktop API 429 is handled without a crash
ok desktop API 500 is handled without a crash
ok desktop API 503 is handled without a crash
ok desktop offline failure and navigation during a slow request stay recoverable
ok desktop five tabs keep independent UI state without page errors
ok desktop login page has no serious accessibility violations
ok mobile malicious strings never execute as HTML or JavaScript
ok mobile twenty rapid submissions produce one network mutation
ok mobile API 429 is handled without a crash
ok mobile API 500 is handled without a crash
ok mobile API 503 is handled without a crash
ok mobile offline failure and navigation during a slow request stay recoverable
ok mobile five tabs keep independent UI state without page errors
ok mobile login page has no serious accessibility violations
16 passed (2.5m)

> PLAYWRIGHT_BASE_URL=http://localhost:3001 playwright test tests/e2e/security-boundaries.spec.ts
Running 4 tests using 1 worker
ok desktop security headers are present and secrets are absent
ok desktop direct mutation without browser origin metadata is rejected
ok mobile security headers are present and secrets are absent
ok mobile direct mutation without browser origin metadata is rejected
4 passed (10.6s)

> PLAYWRIGHT_BASE_URL=http://localhost:3001 playwright test tests/e2e/auth-resilience.spec.ts -g 'twenty rapid'
Running 2 tests using 1 worker
ok desktop twenty rapid submissions produce one network mutation
ok mobile twenty rapid submissions produce one network mutation
2 passed (20.9s)
```

## Production build

```text
> pnpm build
$ vinext build
vinext build (Vite 8.0.13)
[1/5] analyze client references... 505 modules transformed; built in 12.57s
[2/5] analyze server references... 207 modules transformed; built in 3.09s
[3/5] build rsc environment... 498 modules transformed; built in 9.27s
[4/5] build client environment... 213 modules transformed; built in 5.32s
[5/5] build ssr environment... 206 modules transformed; built in 4.01s
Build complete. Run `vinext start` to start the production server.
process exit code: 0
```

## Lighthouse

```text
> LIGHTHOUSE_URL=https://matchpilot-personal.minaduki-co1029.chatgpt.site/ node scripts/run-lighthouse.mjs
{"scores":{"performance":82,"accessibility":96,"best-practices":77}}

> LIGHTHOUSE_URL=http://localhost:3000/ node scripts/run-lighthouse.mjs
{"scores":{"performance":94,"accessibility":100,"best-practices":96}}

> LIGHTHOUSE_URL=http://localhost:3001/ node scripts/run-lighthouse.mjs
{"scores":{"performance":53,"accessibility":100,"best-practices":96}}
```

`localhost:3000` は Cloudflare binding を実行できない Node compatibility server で、静的アセットを圧縮しない。`localhost:3001` は binding を再現する Cloudflare preview だが、初回 document 1.79秒、CSS 211KB未圧縮というローカルオーバーヘッドを含む。したがって公開版との厳密な After 比較は、監査ブランチを preview URL へ配備した後に同じ Lighthouse を実行するまで未確定である。
