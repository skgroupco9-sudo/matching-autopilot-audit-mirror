import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="recovery-page">
      <span className="recovery-mark" aria-hidden="true">M</span>
      <h1>ページが見つかりません</h1>
      <p>リンクが古い可能性があります。MatchPilotのホームから続けてください。</p>
      <div><Link href="/" className="primary-button">ホームへ戻る</Link><Link href="/support" className="secondary-button">ヘルプを見る</Link></div>
    </main>
  );
}
