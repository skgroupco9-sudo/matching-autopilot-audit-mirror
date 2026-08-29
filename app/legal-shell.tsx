import Link from 'next/link';

export function LegalShell({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <main className="legal-page">
      <header className="legal-topbar">
        <Link href="/" className="legal-brand" aria-label="MatchPilotへ戻る"><span>M</span><strong>MatchPilot</strong></Link>
        <Link href="/" className="legal-back">アプリへ戻る</Link>
      </header>
      <article className="legal-document">
        <p className="legal-kicker">安全と透明性</p>
        <h1>{title}</h1>
        <p className="legal-summary">{summary}</p>
        <p className="legal-updated">最終更新：2026年8月24日</p>
        <div className="legal-content">{children}</div>
      </article>
      <nav className="legal-footer" aria-label="法的情報">
        <Link href="/privacy">プライバシー</Link>
        <Link href="/terms">利用規約</Link>
        <Link href="/account-deletion">アカウント削除</Link>
        <Link href="/support">ヘルプ</Link>
        <Link href="/sources">設計ソース</Link>
      </nav>
    </main>
  );
}
