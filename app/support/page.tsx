import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/app/legal-shell';

export const metadata: Metadata = {
  title: 'ヘルプとサポート',
  description: 'MatchPilotの接続、ログイン、データ削除、障害復旧に関する案内です。',
};

export default function SupportPage() {
  return (
    <LegalShell title="ヘルプとサポート" summary="困ったときに必要な操作だけを、短い手順で案内します。">
      <section><h2>ログインできない</h2><p>メールアドレスの前後に空白がないか、パスワードが8文字以上か確認してください。連続して失敗した場合は15分待ってから再試行します。2段階認証を有効にしている場合はTelegramの「L婚サポート２」へ届く6桁コードを10分以内に入力します。パスワードを忘れた場合も、ログイン画面から接続済みTelegramを使って再設定できます。</p><p><Link href="/security">セキュリティと復旧を開く</Link></p></section>
      <section id="worker-recovery"><h2>同期・返信案が動かない</h2><p>設定の「ブラウザワーカー」を開き、上から状態を確認します。「オフライン」は常時稼働PCでワーカーを起動、「設定不足」はワーカーの <code>OPENAI_API_KEY</code> を設定して再起動します。サービスが「本人確認待ち」「再ログイン」の場合は公式画面で本人操作を完了すると、自動巡回へ戻ります。</p><p>順番は、常時稼働PCの通信確認 → ワーカー再起動 → サービスへ再ログイン → 管理画面の最終接続時刻確認です。同じ処理を二重送信しないため、復旧中のジョブは安全に保留されます。</p></section>
      <section><h2>Gmailの認証コードが見つからない</h2><p>登録情報ハブで「認証コード取得を許可」を有効にして保存し、メール受信後15分以内に再試行してください。サービス名で絞り込んで見つからない場合は空欄にします。権限を取り消した場合はGmailを再接続してください。</p></section>
      <section><h2>ホーム画面に追加したい</h2><p>iPhone／iPadはSafariの共有ボタンから「ホーム画面に追加」、Androidはブラウザメニューの「アプリをインストール」を選びます。</p></section>
      <section><h2>データを確認・削除したい</h2><p>設定の「個人データを書き出す」でJSONを保存できます。運用データは毎日暗号化バックアップされ、直近7回を保持します。完全削除は<Link href="/account-deletion">アカウント削除ページ</Link>から手順を確認できます。</p></section>
      <section><h2>ブラウザ版として使いたい</h2><p>App StoreやGoogle Playからのインストールは不要です。このサイトへログインし、必要ならホーム画面へ追加してください。同じアカウントでiPhone、Android、PCから管理できます。</p></section>
    </LegalShell>
  );
}
