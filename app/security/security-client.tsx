'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { HubHeader } from '@/app/services/services-client';
import type { DashboardPayload } from '@/lib/dashboard-types';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';
import { unicodeLength } from '@/lib/unicode-text';

type SelfTestCheck = { id: string; label: string; ok: boolean; detail: string; required?: boolean };

export default function SecurityClient() {
  const fetchWithTimeout = useGuardedFetch();
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [lastSelfTestAt, setLastSelfTestAt] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [checks, setChecks] = useState<SelfTestCheck[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [mfaResponse, backupResponse, dashboardResponse] = await Promise.all([
        fetchWithTimeout('/api/auth/mfa/settings', { cache: 'no-store' }),
        fetchWithTimeout('/api/data/backup', { cache: 'no-store' }),
        fetchWithTimeout('/api/dashboard', { cache: 'no-store' }),
      ]);
      if (!mfaResponse.ok || !backupResponse.ok || !dashboardResponse.ok) throw new Error('load_failed');
      const mfa = await mfaResponse.json() as { enabled: boolean; telegramLinked: boolean };
      const backup = await backupResponse.json() as { lastBackupAt: string | null };
      const dashboard = await dashboardResponse.json() as DashboardPayload;
      setMfaEnabled(mfa.enabled);
      setTelegramLinked(mfa.telegramLinked);
      setLastBackupAt(backup.lastBackupAt);
      setLastSelfTestAt(dashboard.user.lastSelfTestAt);
    } catch {
      setNotice('セキュリティ状態を読み込めませんでした。');
    }
  }, [fetchWithTimeout]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const toggleMfa = async () => {
    if (!currentPassword || busy) return;
    setBusy('mfa');
    setNotice('');
    try {
      const response = await fetchWithTimeout('/api/auth/mfa/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !mfaEnabled, currentPassword }) });
      const result = await response.json() as { enabled?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'mfa_failed');
      setMfaEnabled(result.enabled === true);
      setCurrentPassword('');
      setNotice(result.enabled ? 'Telegram 2段階認証を有効にしました。' : '2段階認証を無効にしました。');
    } catch (error) {
      setNotice(error instanceof Error && error.message === 'telegram_required' ? '先にTelegramを接続してください。' : '現在のパスワードを確認してください。');
    } finally {
      setBusy('');
    }
  };

  const changePassword = async () => {
    if (!currentPassword || unicodeLength(newPassword) < 8 || busy) return;
    if (newPassword !== confirmation) { setNotice('新しいパスワードが一致しません。'); return; }
    setBusy('password');
    setNotice('');
    try {
      const response = await fetchWithTimeout('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'password_failed');
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
      setNotice('パスワードを変更し、ほかの端末のセッションを終了しました。');
    } catch {
      setNotice('現在のパスワードと新しいパスワードを確認してください。');
    } finally {
      setBusy('');
    }
  };

  const createBackup = async () => {
    if (busy) return;
    setBusy('backup'); setNotice('');
    try {
      const response = await fetchWithTimeout('/api/data/backup', { method: 'POST' });
      const result = await response.json() as { lastBackupAt?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'backup_failed');
      setLastBackupAt(result.lastBackupAt ?? new Date().toISOString());
      setNotice('暗号化バックアップを作成しました。直近7日分を自動保持します。');
    } catch {
      setNotice('バックアップを作成できませんでした。暗号化設定を確認してください。');
    } finally { setBusy(''); }
  };

  const runSelfTest = async (notifyTelegram = false) => {
    if (busy) return;
    setBusy(notifyTelegram ? 'notify-test' : 'test'); setNotice(''); setChecks([]);
    try {
      const response = await fetchWithTimeout(`/api/operations/self-test${notifyTelegram ? '?notify=1' : ''}`, { method: 'POST' });
      const result = await response.json() as { ok?: boolean; operationalReady?: boolean; notified?: boolean; checkedAt?: string; checks?: SelfTestCheck[]; error?: string };
      if (!response.ok || !result.checks) throw new Error(result.error ?? 'test_failed');
      setChecks(result.checks);
      if (result.ok) setLastSelfTestAt(result.checkedAt ?? new Date().toISOString());
      setNotice(result.ok
        ? notifyTelegram && result.notified ? '内部システムに合格し、Telegram通知も確認できました。' : '内部システムの安全診断に合格しました。外部送信はしていません。'
        : '内部システムに不足があります。下の必須項目を確認してください。');
    } catch {
      setNotice('総合セルフテストを実行できませんでした。');
    } finally { setBusy(''); }
  };

  return <main className="hub-page settings-hub-page">
    <HubHeader current="security" />
    <section className="settings-hub-hero"><span className="hub-eyebrow">SECURITY & RECOVERY</span><h1>守る・戻す・確かめる。</h1><p>ログイン保護、毎日の暗号化バックアップ、運用開始前の総合診断を一つにまとめました。</p></section>
    <div className="settings-form-grid worker-setup-grid security-operations-grid">
      <section className="settings-panel span-2"><header><span>01</span><div><h2>Telegram 2段階認証</h2><p>パスワードが合っていても、Telegramの6桁コードがなければログインできません</p></div></header>
        <div className="bulk-audit-answer"><span>現在の状態</span><strong>{mfaEnabled ? '有効' : '無効'}</strong><p>{telegramLinked ? 'Telegramは接続済みです。' : '先にTelegram接続が必要です。'}</p></div>
        <label className="floating-field"><span>現在のパスワード</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="current-password" /></label>
        <button type="button" className="hub-state-action" disabled={busy === 'mfa' || !currentPassword || (!telegramLinked && !mfaEnabled)} onClick={() => void toggleMfa()}>{busy === 'mfa' ? '変更中…' : mfaEnabled ? '2段階認証を無効にする' : '2段階認証を有効にする'}</button>
      </section>

      <section className="settings-panel span-2"><header><span>02</span><div><h2>パスワードと全端末セッション</h2><p>変更すると、この端末以外のログイン状態を無効にします</p></div></header>
        <div className="two-column-fields"><label className="floating-field"><span>新しいパスワード</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" /></label><label className="floating-field"><span>もう一度入力</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" /></label></div>
        <button type="button" className="hub-state-action" disabled={busy === 'password' || !currentPassword || unicodeLength(newPassword) < 8 || newPassword !== confirmation} onClick={() => void changePassword()}>{busy === 'password' ? '変更中…' : 'パスワードを変更'}</button>
      </section>

      <section className="settings-panel" id="backup"><header><span>03</span><div><h2>暗号化バックアップ</h2><p>運用データを毎日保存し、直近7回を保持します</p></div></header><div className="bulk-audit-answer"><span>最終バックアップ</span><strong>{formatDate(lastBackupAt)}</strong><p>秘密情報は暗号化された状態で二重に保護します。</p></div><button type="button" className="hub-state-action" disabled={busy === 'backup'} onClick={() => void createBackup()}>{busy === 'backup' ? '作成中…' : '今すぐバックアップ'}</button></section>
      <section className="settings-panel" id="self-test"><header><span>04</span><div><h2>総合セルフテスト</h2><p>DB・保管・バックアップ復号・ワーカー・AIを安全に診断します</p></div></header><div className="bulk-audit-answer"><span>最終合格</span><strong>{formatDate(lastSelfTestAt)}</strong><p>通常診断はTelegramやマッチング相手へ何も送りません。通知テストを選んだ場合だけ、あなたのTelegramへ結果を1件送ります。</p></div><div className="security-test-actions"><button type="button" className="hub-state-action" disabled={Boolean(busy)} onClick={() => void runSelfTest(false)}>{busy === 'test' ? '安全診断中…' : '送信なしで安全診断'}</button><button type="button" className="bulk-secondary-action" disabled={Boolean(busy) || !telegramLinked} onClick={() => void runSelfTest(true)}>{busy === 'notify-test' ? '通知確認中…' : 'Telegram通知もテスト'}</button></div></section>
      <section className="settings-panel span-2" id="account-safety"><header><span>05</span><div><h2>アカウント保護モード</h2><p>規約違反や異常な連続操作につながる動作を常時停止します</p></div><b className="tiny-status bg-emerald-50 text-emerald-700">常時ON</b></header>
        <div className="security-check-list">
          <article className="is-ok"><i>1</i><span><strong>1サービス1アカウント</strong><small>既存接続があるサービスの新規登録準備を拒否</small></span></article>
          <article className="is-ok"><i>5</i><span><strong>1サービス1日5人まで</strong><small>新しい相手への操作をサーバー側で上限制御</small></span></article>
          <article className="is-ok"><i>24</i><span><strong>同文面の連続送信を保留</strong><small>24時間以内に別の相手へ送った同一文面は本人確認へ戻す</small></span></article>
          <article className="is-ok"><i>!</i><span><strong>異常時サーキットブレーカー</strong><small>外部操作が最終失敗したら接続を停止し、残りの操作予約も取り消す</small></span></article>
          <article className="is-ok"><i>✓</i><span><strong>公式許可のない自動操作は実行しない</strong><small>CAPTCHA・OTP・本人確認・規約同意は必ず本人へ引き継ぐ</small></span></article>
          <article><i>i</i><span><strong>凍結ゼロは保証できません</strong><small>サービス側の判定は非公開です。IP・端末偽装や検知回避は行いません</small></span></article>
        </div>
        <Link href="/sources" className="bulk-secondary-action">確認した公式規約と反映内容を見る <span aria-hidden="true">→</span></Link>
      </section>
      {checks.length > 0 && <section className="settings-panel span-2"><header><span>✓</span><div><h2>最新の診断結果</h2><p>必須と実地確認を分けて表示します</p></div></header><div className="security-check-list">{checks.map((check) => <article key={check.id} className={check.ok ? 'is-ok' : check.required ? 'is-action' : ''}><i>{check.ok ? '✓' : check.required ? '!' : 'i'}</i><span><strong>{check.label}{check.required === false ? '（実地確認）' : ''}</strong><small>{check.detail}</small></span></article>)}</div></section>}
    </div>
    {notice && <div className="hub-notice is-ok worker-notice" role="status"><span>{notice}</span></div>}
    <div className="worker-setup-footer"><Link href="/?view=settings">設定へ戻る</Link><a href="/api/data/export">個人データを書き出す</a></div>
  </main>;
}

function formatDate(value: string | null) {
  if (!value) return 'まだありません';
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
