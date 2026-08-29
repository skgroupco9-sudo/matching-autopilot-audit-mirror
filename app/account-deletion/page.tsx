import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/app/legal-shell';

export const metadata: Metadata = {
  title: 'アカウント削除',
  description: 'MatchPilotのアカウントと関連データを削除する方法を説明します。',
};

export default function AccountDeletionPage() {
  return (
    <LegalShell title="アカウントとデータの削除" summary="ログイン後の設定から、追加の問い合わせなしで削除を完了できます。">
      <section className="deletion-steps"><h2>削除手順</h2><ol><li><span>1</span><div><strong>MatchPilotへログイン</strong><p>登録したメールアドレスとパスワードを使用します。</p></div></li><li><span>2</span><div><strong>設定 → データとプライバシー</strong><p>「アカウントとデータを削除」を選びます。</p></div></li><li><span>3</span><div><strong>本人確認して削除</strong><p>現在のパスワードと確認語を入力すると削除されます。</p></div></li></ol><Link href="/?delete=1" className="legal-primary-action">ログインして削除手続きへ</Link></section>
      <section><h2>削除される情報</h2><p>MatchPilotのアカウント、登録情報ハブ、暗号化したサービス用パスワード・本人確認書類・AI APIキー、Google接続トークン、候補、会話、返信案、スクリーンショット、接続状態、ルール、学習メモリ、Telegram連携、監査記録を削除します。稼働中のStripe契約が検出された場合は削除前に停止します。</p></section>
      <section><h2>削除されない情報</h2><p>各マッチングサービスおよびTelegram側のアカウント・会話は、それぞれのサービスで管理されています。必要に応じて各サービスでも削除してください。法令上の保存義務がある決済記録はStripe等で所定期間保持される場合があります。</p></section>
    </LegalShell>
  );
}
