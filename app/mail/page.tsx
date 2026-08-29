import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPersonalUser } from '@/app/personal-auth';
import styles from './mail.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'メール管理 | Esteman',
  description: '最大99件のGmailをEstemanから一括管理します。',
};

export default async function MailPage() {
  const user = await getPersonalUser();
  if (!user) redirect('/');

  return (
    <main className={styles.page}>
      <div className={styles.atmosphere} aria-hidden="true" />
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="Estemanホームへ戻る">
            <span>EM</span>
            <div><strong>Esteman</strong><small>MAIL OPERATIONS</small></div>
          </Link>
          <div className={styles.headerActions}>
            <span className={styles.userBadge}><i aria-hidden="true" />{user.displayName}</span>
            <Link href="/" className={styles.backLink}>ホームへ戻る</Link>
          </div>
        </header>

        <section className={styles.hero}>
          <div>
            <p className={styles.kicker}>UNIFIED GMAIL COMMAND</p>
            <h1>メール管理</h1>
            <p className={styles.lead}>99個のGmailを、迷わない一画面へ。受信・検索・整理・一括操作・通知まで、Estemanからまとめて管理できます。</p>
            <div className={styles.heroActions}>
              <a href="https://mail-orbit-99.vercel.app" target="_blank" rel="noopener noreferrer" className={styles.primaryAction}>フル画面で開く</a>
              <a href="#mail-workspace" className={styles.secondaryAction}>このページで使う</a>
            </div>
          </div>
          <div className={styles.orbit} aria-label="最大99 Gmailアカウント">
            <span>MAX</span><strong>99</strong><small>GMAIL ACCOUNTS</small>
          </div>
        </section>

        <section className={styles.metrics} aria-label="メール管理の主要機能">
          <article><span>SYNC</span><strong>60秒</strong><small>自動更新</small></article>
          <article><span>ACTIONS</span><strong>一括</strong><small>既読・アーカイブ・ラベル</small></article>
          <article><span>ALERT</span><strong>通知＋音</strong><small>新着を見逃さない</small></article>
        </section>

        <section id="mail-workspace" className={styles.workspace} aria-labelledby="workspace-title">
          <div className={styles.workspaceHead}>
            <div><p>MAIL ORBIT</p><h2 id="workspace-title">統合メールワークスペース</h2></div>
            <div className={styles.liveBadge}><i aria-hidden="true" />SECURE CONNECTION</div>
          </div>
          <div className={styles.guidance} role="note">
            <strong>初回のGoogle接続とブラウザ通知</strong>
            <span>Google認証や通知許可は「フル画面で開く」から設定すると、iPhone・Androidでも確実です。設定後はこの画面でも操作できます。</span>
          </div>
          <div className={styles.frameShell}>
            <iframe
              src="https://mail-orbit-99.vercel.app/?embed=esteman"
              title="Mail Orbit Gmail一括管理"
              loading="eager"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="clipboard-read; clipboard-write"
            />
          </div>
        </section>

        <section className={styles.capabilities} aria-label="利用できる機能">
          <article><span>01</span><div><h2>統合受信箱</h2><p>接続したGmailを横断し、アカウントを切り替えずに検索・確認します。</p></div></article>
          <article><span>02</span><div><h2>スマートフォルダ</h2><p>店舗、採用、予約、請求など、業務に合わせた検索条件で自動整理します。</p></div></article>
          <article><span>03</span><div><h2>一括処理</h2><p>複数メールをまとめて既読、スター、アーカイブ、ラベル変更できます。</p></div></article>
          <article><span>04</span><div><h2>安全な接続</h2><p>Gmailパスワードは保存せず、Google公式OAuthと暗号化トークンを使用します。</p></div></article>
        </section>
      </div>
    </main>
  );
}
