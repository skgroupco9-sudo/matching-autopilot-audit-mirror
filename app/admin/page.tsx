'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';

type AdminAccount = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
  automationState: 'active' | 'paused' | 'needs_attention';
  telegramLinked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  billingStatus: string | null;
  connectionsCount: number;
  activeConversations: number;
};

type AdminInvite = {
  id: string;
  email: string;
  role: 'admin' | 'user';
  status: 'pending' | 'accepted' | 'revoked';
  expiresAt: string;
  createdAt: string;
};

function formatDate(value: string | null) {
  if (!value) return '未ログイン';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function billingLabel(status: string | null) {
  if (!status) return '未契約';
  const labels: Record<string, string> = {
    active: '契約中',
    trialing: '無料期間',
    past_due: '支払い確認',
    unpaid: '未払い',
    canceled: '解約済み',
    incomplete: '手続き中',
    incomplete_expired: '期限切れ',
    paused: '一時停止',
  };
  return labels[status] ?? status;
}

export default function AdminPage() {
  const fetchWithTimeout = useGuardedFetch();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [createdInviteLink, setCreatedInviteLink] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [accountsResponse, invitesResponse] = await Promise.all([
        fetchWithTimeout('/api/admin/accounts', { cache: 'no-store', headers: { accept: 'application/json' } }),
        fetchWithTimeout('/api/admin/invites', { cache: 'no-store', headers: { accept: 'application/json' } }),
      ]);
      if (accountsResponse.status === 401) throw new Error('authentication_required');
      if (accountsResponse.status === 403) throw new Error('admin_required');
      if (!accountsResponse.ok || !invitesResponse.ok) throw new Error('load_failed');
      const accountResult = (await accountsResponse.json()) as { currentUserId: string; accounts: AdminAccount[] };
      const inviteResult = (await invitesResponse.json()) as { invites: AdminInvite[] };
      setAccounts(accountResult.accounts);
      setCurrentUserId(accountResult.currentUserId);
      setInvites(inviteResult.invites);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : 'load_failed';
      setError(code === 'authentication_required'
        ? 'ログインが必要です。'
        : code === 'admin_required'
          ? 'このページを表示する管理者権限がありません。'
          : '管理データを読み込めませんでした。');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithTimeout]);

  useEffect(() => {
    void Promise.resolve().then(() => loadData());
  }, [loadData]);

  const filteredAccounts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return accounts;
    return accounts.filter((account) => `${account.displayName} ${account.email} ${account.role} ${account.status}`.toLowerCase().includes(normalized));
  }, [accounts, query]);

  const activeCount = accounts.filter((account) => account.status === 'active').length;
  const telegramCount = accounts.filter((account) => account.telegramLinked).length;
  const subscriberCount = accounts.filter((account) => ['active', 'trialing'].includes(account.billingStatus ?? '')).length;

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inviteEmail.trim() || isSaving) return;
    setIsSaving(true);
    setNotice(null);
    setCreatedInviteLink('');
    try {
      const response = await fetchWithTimeout('/api/admin/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const result = (await response.json()) as { invite?: { path: string }; error?: string };
      if (!response.ok || !result.invite) throw new Error(result.error ?? 'invite_failed');
      setCreatedInviteLink(`${window.location.origin}${result.invite.path}`);
      setInviteEmail('');
      setNotice('72時間有効な招待リンクを発行しました。リンクはこの画面で一度だけ表示します。');
      await loadData();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : 'invite_failed';
      setNotice(code === 'email_in_use' ? 'このメールアドレスは登録済みです。' : code === 'invalid_email' ? '有効なメールアドレスを入力してください。' : '招待を発行できませんでした。');
    } finally {
      setIsSaving(false);
    }
  };

  const copyInvite = async () => {
    if (!createdInviteLink) return;
    await navigator.clipboard.writeText(createdInviteLink);
    setNotice('招待リンクをコピーしました。');
  };

  const revokeInvite = async (invite: AdminInvite) => {
    if (!window.confirm(`${invite.email} の招待を無効にしますか？`)) return;
    setBusyId(invite.id);
    try {
      const response = await fetchWithTimeout(`/api/admin/invites/${encodeURIComponent(invite.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('revoke_failed');
      setNotice('招待を無効にしました。');
      await loadData();
    } catch {
      setNotice('招待を無効にできませんでした。');
    } finally {
      setBusyId(null);
    }
  };

  const toggleAccountStatus = async (account: AdminAccount) => {
    const nextStatus = account.status === 'active' ? 'suspended' : 'active';
    const action = nextStatus === 'suspended' ? '停止' : '再開';
    if (!window.confirm(`${account.email} のアカウントを${action}しますか？`)) return;
    setBusyId(account.id);
    try {
      const response = await fetchWithTimeout(`/api/admin/accounts/${encodeURIComponent(account.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) throw new Error('status_failed');
      setNotice(`アカウントを${action}しました。`);
      await loadData();
    } catch {
      setNotice(`アカウントを${action}できませんでした。`);
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return <main className="admin-page"><div className="admin-state"><span className="state-spinner" aria-hidden="true" /><h1>管理データを読み込んでいます</h1><p>権限とアカウント状態を確認しています。</p></div></main>;

  if (error) return <main className="admin-page"><div className="admin-state"><span className="admin-state-mark">!</span><h1>管理者ページを開けません</h1><p>{error}</p><div className="admin-state-actions"><Link href="/" className="admin-button secondary">ログイン画面へ</Link><button type="button" className="admin-button" onClick={() => void loadData()}>再試行</button></div></div></main>;

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <Link href="/" className="admin-brand"><span>M</span><strong>MatchPilot</strong><small>ADMIN</small></Link>
        <Link href="/" className="admin-back">← ダッシュボードへ戻る</Link>
      </header>

      <div className="admin-container">
        <section className="admin-hero">
          <div><p className="eyebrow">ACCOUNT CONTROL</p><h1>アカウント管理</h1><p>登録者・契約・Telegram接続・利用状況を、必要最小限の情報だけで確認します。</p></div>
          <span className="admin-shield">管理者専用</span>
        </section>

        {notice && <div className="admin-notice" role="status"><span>✓</span><p>{notice}</p><button type="button" onClick={() => setNotice(null)} aria-label="閉じる">×</button></div>}

        <section className="admin-metrics" aria-label="アカウント概要">
          <article><span>登録アカウント</span><strong>{accounts.length}</strong><small>管理者を含む</small></article>
          <article><span>利用可能</span><strong>{activeCount}</strong><small>{accounts.length - activeCount}件停止中</small></article>
          <article><span>Telegram接続</span><strong>{telegramCount}</strong><small>通知先登録済み</small></article>
          <article><span>有効な契約</span><strong>{subscriberCount}</strong><small>無料期間を含む</small></article>
        </section>

        <section className="admin-management-grid">
          <article className="admin-card admin-invite-card">
            <div className="admin-card-heading"><div><p className="eyebrow">INVITE</p><h2>新しいユーザーを招待</h2></div><span>72時間有効</span></div>
            <p>招待したメールアドレスだけが登録できます。パスワードは本人が設定し、管理者には表示されません。</p>
            <form onSubmit={createInvite}>
              <label htmlFor="invite-email">メールアドレス</label>
              <div><input id="invite-email" type="email" inputMode="email" autoComplete="off" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" maxLength={254} required /><button type="submit" disabled={isSaving || !inviteEmail.trim()}>{isSaving ? '発行中…' : '招待を発行'}</button></div>
            </form>
            {createdInviteLink && <div className="admin-created-link"><label htmlFor="created-invite">招待リンク</label><div><input id="created-invite" readOnly value={createdInviteLink} /><button type="button" onClick={() => void copyInvite()}>コピー</button></div><small>安全のため、このリンクは再表示できません。</small></div>}
          </article>

          <article className="admin-card">
            <div className="admin-card-heading"><div><p className="eyebrow">PENDING</p><h2>保留中の招待</h2></div><span>{invites.length}件</span></div>
            <div className="admin-invite-list">
              {invites.map((invite) => <div key={invite.id}><span className="admin-avatar">{invite.email.slice(0, 1).toUpperCase()}</span><span><strong>{invite.email}</strong><small>{formatDate(invite.expiresAt)}まで</small></span><button type="button" disabled={busyId === invite.id} onClick={() => void revokeInvite(invite)}>{busyId === invite.id ? '処理中' : '無効化'}</button></div>)}
              {invites.length === 0 && <div className="admin-empty"><span>✓</span><p>保留中の招待はありません。</p></div>}
            </div>
          </article>
        </section>

        <section className="admin-card admin-accounts-card">
          <div className="admin-list-header"><div><p className="eyebrow">ACCOUNTS</p><h2>アカウント一覧</h2></div><label><span className="sr-only">アカウントを検索</span><input type="search" maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・メールで検索" /></label></div>
          <div className="admin-table-wrap" tabIndex={0} role="region" aria-label="アカウント一覧">
            <table className="admin-table">
              <thead><tr><th>アカウント</th><th>権限・状態</th><th>利用状況</th><th>接続</th><th>最終ログイン</th><th><span className="sr-only">操作</span></th></tr></thead>
              <tbody>
                {filteredAccounts.map((account) => <tr key={account.id}>
                  <td><div className="admin-account-cell"><span className="admin-avatar">{account.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{account.displayName}{account.id === currentUserId && <em>自分</em>}</strong><small>{account.email}</small></span></div></td>
                  <td><div className="admin-badge-row"><span className={`admin-badge ${account.role === 'admin' ? 'is-admin' : ''}`}>{account.role === 'admin' ? '管理者' : 'ユーザー'}</span><span className={`admin-badge ${account.status === 'active' ? 'is-active' : 'is-suspended'}`}>{account.status === 'active' ? '利用可能' : '停止中'}</span></div></td>
                  <td><strong className="admin-cell-primary">{billingLabel(account.billingStatus)}</strong><small className="admin-cell-secondary">会話中 {account.activeConversations}件</small></td>
                  <td><strong className="admin-cell-primary">アプリ {account.connectionsCount}件</strong><small className="admin-cell-secondary">Telegram {account.telegramLinked ? '接続済み' : '未接続'}</small></td>
                  <td><strong className="admin-cell-primary">{formatDate(account.lastLoginAt)}</strong><small className="admin-cell-secondary">登録 {formatDate(account.createdAt)}</small></td>
                  <td>{account.role === 'user' && account.id !== currentUserId ? <button type="button" className={`admin-status-button ${account.status === 'active' ? 'danger' : ''}`} disabled={busyId === account.id} onClick={() => void toggleAccountStatus(account)}>{busyId === account.id ? '処理中' : account.status === 'active' ? '停止' : '再開'}</button> : <span className="admin-protected">保護</span>}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {filteredAccounts.length === 0 && <div className="admin-empty large"><span>⌕</span><p>条件に一致するアカウントはありません。</p></div>}
        </section>

        <p className="admin-privacy-note">管理者ページにはパスワード、認証トークン、会話本文、マッチ相手の個人情報を表示しません。</p>
      </div>
    </main>
  );
}
