'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="recovery-page">
      <span className="recovery-mark" aria-hidden="true">!</span>
      <h1>読み込みを完了できませんでした</h1>
      <p>入力内容は送信されていません。接続を確認して、もう一度お試しください。</p>
      <div><button type="button" onClick={reset} className="primary-button">もう一度試す</button><Link href="/support" className="secondary-button">ヘルプを見る</Link></div>
    </main>
  );
}
