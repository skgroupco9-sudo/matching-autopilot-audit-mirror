'use client';

import { HubHeader } from '@/app/services/services-client';
import type { ConnectorDefinition } from '@/lib/automation/types';
import type { IdentityProfilePayload } from '@/lib/identity-types';
import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';

type TierFilter = 'all' | 'standard' | 'beta';
type Notice = { tone: 'ok' | 'error'; title: string; text: string } | null;

const requiredProfileFields = [
  ['registrationEmail', '登録メール'],
  ['phoneNumber', '電話番号'],
  ['nickname', 'ニックネーム'],
  ['birthDate', '生年月日'],
  ['residence', '居住地'],
] as const;

export default function BulkAccountClient({ services, identity, initialProviders = [] }: { services: ConnectorDefinition[]; identity: IdentityProfilePayload; initialProviders?: string[] }) {
  const fetchWithTimeout = useGuardedFetch();
  const [selected, setSelected] = useState<string[]>(() => {
    const available = new Set<string>(services.map((service) => service.id));
    const valid = initialProviders.filter((provider) => available.has(provider));
    return valid.length > 0 ? valid : services.filter((service) => service.automationTier === 'standard').map((service) => service.id);
  });
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [tier, setTier] = useState<TierFilter>('all');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const missingFields = requiredProfileFields.filter(([field]) => !identity.profile[field]);
  const profileReady = identity.vaultConfigured && identity.profile.registrationAssistEnabled && missingFields.length === 0;
  const selectedCredentialCount = identity.credentials.filter((credential) => selected.includes(credential.serviceKey)).length;
  const filtered = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase('ja-JP');
    return services.filter((service) => {
      const tierMatches = tier === 'all' || service.automationTier === tier;
      const queryMatches = !normalized || `${service.label} ${service.registrationMethods.join(' ')}`.toLocaleLowerCase('ja-JP').includes(normalized);
      return tierMatches && queryMatches;
    });
  }, [deferredQuery, services, tier]);

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const selectTier = (target: 'all' | 'standard') => {
    setSelected(services.filter((service) => target === 'all' || service.automationTier === 'standard').map((service) => service.id));
  };

  const start = async () => {
    if (!profileReady || selected.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetchWithTimeout('/api/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'connection.addMany', providers: selected, connectionIntent: 'new' }),
      });
      const result = await response.json() as { connectionIds?: string[]; skippedProviders?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'bulk_start_failed');
      const skippedText = result.skippedProviders?.length
        ? ` 既存接続${result.skippedProviders.length}件は二重登録防止のため除外しました。`
        : '';
      setNotice({
        tone: 'ok',
        title: `${result.connectionIds?.length ?? selected.length}件の登録準備を受け付けました`,
        text: `この時点で作成完了したアカウントは0件です。公式登録画面を開いて共通情報と許可済みパスワードを補助入力し、送信・認証・規約同意の前で停止して通知します。${skippedText}`,
      });
    } catch (error) {
      setNotice({ tone: 'error', title: '一括準備を開始できませんでした', text: bulkErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="hub-page bulk-account-page">
      <HubHeader current="accounts" />
      <section className="bulk-hero">
        <div><span className="hub-eyebrow">ONE PROFILE · {services.length} WEB CANDIDATES</span><h1>一度入力して、<br />まとめて準備。</h1><p>共通情報を安全に再利用し、外部操作の許可を確認できるWeb候補だけを独立セッションで準備します。本人操作と規約上の境界は必ず停止して通知します。</p></div>
        <div className="bulk-hero-summary"><span><strong>{services.length}</strong><small>接続準備候補</small></span><span><strong>{selected.length}</strong><small>選択中</small></span><span><strong>{services.filter((service) => service.automationTier === 'standard').length}</strong><small>優先確認</small></span></div>
      </section>

      <section className="bulk-flow" aria-label="一括アカウント準備の手順">
        <article className={`bulk-readiness-card ${profileReady ? 'is-ready' : ''}`}>
          <header><span>01</span><div><h2>共通情報</h2><p>必要項目を一度だけ保存</p></div><b>{profileReady ? '準備完了' : '要設定'}</b></header>
          <div className="bulk-readiness-grid">
            {requiredProfileFields.map(([field, label]) => <span key={field} className={identity.profile[field] ? 'is-done' : ''}><i aria-hidden="true">{identity.profile[field] ? '✓' : '!'}</i>{label}</span>)}
            <span className={identity.profile.phoneOwnershipConfirmed ? 'is-done' : ''}><i aria-hidden="true">{identity.profile.phoneOwnershipConfirmed ? '✓' : '!'}</i>電話番号の所有確認</span>
            <span className={identity.gmail.connected ? 'is-done' : ''}><i aria-hidden="true">{identity.gmail.connected ? '✓' : '·'}</i>Gmail認証補助</span>
            <span className={identity.credentials.length > 0 ? 'is-done' : ''}><i aria-hidden="true">{identity.credentials.length > 0 ? '✓' : '·'}</i>パスワード {identity.credentials.length}件</span>
          </div>
          {!identity.vaultConfigured && <p className="bulk-warning">暗号化保管庫が未設定です。管理環境の設定完了後に利用できます。</p>}
          {identity.vaultConfigured && !identity.profile.registrationAssistEnabled && <p className="bulk-warning">共通情報の「新規登録準備への使用」をONにしてください。</p>}
          {missingFields.length > 0 && <p className="bulk-warning">未入力：{missingFields.map(([, label]) => label).join('、')}</p>}
          <Link href="/identity" className="bulk-secondary-action">共通情報を確認・編集 <span aria-hidden="true">→</span></Link>
        </article>

        <article className="bulk-service-panel">
          <header><span>02</span><div><h2>Webサービスを選択</h2><p>アプリ専用は最初から対象外</p></div><b>{selected.length}/{services.length}</b></header>
          <div className="bulk-service-tools">
            <label className="hub-search"><span aria-hidden="true">⌕</span><span className="sr-only">サービスを検索</span><input maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="サービス名・登録方法を検索" /></label>
            <div className="bulk-tier-filter" role="group" aria-label="接続確認レベル">{([['all', 'すべて'], ['standard', '優先'], ['beta', '汎用']] as const).map(([value, label]) => <button key={value} type="button" className={tier === value ? 'is-active' : ''} onClick={() => setTier(value)} aria-pressed={tier === value}>{label}</button>)}</div>
            <div className="bulk-select-actions"><button type="button" onClick={() => selectTier('standard')}>優先候補</button><button type="button" onClick={() => selectTier('all')}>{services.length}件すべて</button><button type="button" onClick={() => setSelected([])}>解除</button></div>
          </div>
          <div className="bulk-service-list" aria-live="polite">
            {filtered.map((service) => {
              const active = selected.includes(service.id);
              return <button key={service.id} type="button" className={active ? 'is-selected' : ''} onClick={() => toggle(service.id)} aria-pressed={active}>
                <span className="bulk-service-mark" aria-hidden="true">{Array.from(service.label)[0]}</span>
                <span><strong>{service.label}</strong><small>{service.registrationMethods.join('・')}</small></span>
                <em className={`is-${service.automationTier}`}>{service.automationTier === 'standard' ? '優先' : '汎用'}</em>
                <i aria-hidden="true">{active ? '✓' : '+'}</i>
              </button>;
            })}
          </div>
          {filtered.length === 0 && <div className="bulk-empty">該当するWebサービスがありません</div>}
        </article>

        <article className="bulk-launch-card">
          <header><span>03</span><div><h2>一括登録準備</h2><p>登録画面をまとめて準備・作成確定はしない</p></div></header>
          <div className="bulk-audit-answer"><span>監査結果</span><strong>ボタンだけではアカウント作成は完了しません</strong><p>選択中{selected.length}件のうち、パスワード保存済みは{selectedCredentialCount}件です。登録画面の仕様がサービスごとに異なるため、誤登録を防いで最終送信前に停止します。</p></div>
          <ol><li><span>1</span><p><strong>公式登録画面を準備</strong><small>選択したサービスを独立セッションで起動</small></p></li><li><span>2</span><p><strong>共通情報を補助入力</strong><small>一致を確認できる欄だけ入力し、送信前に停止</small></p></li><li><span>3</span><p><strong>本人操作を通知</strong><small>パスワード・認証・CAPTCHA・規約・課金確定</small></p></li><li><span>4</span><p><strong>許可範囲を確認</strong><small>公式機能・手動操作・許可済み自動化へ振り分け</small></p></li></ol>
          <div className="bulk-boundary"><strong>勝手に確定しません</strong><p>公式画面の本人確認・規約同意・有料購入は、必ずあなたの操作で確定します。画面を一意に判定できないβ接続も停止して報告します。</p></div>
          <div className="bulk-boundary"><strong>1サービス1アカウントを固定</strong><p>すでに接続履歴があるサービスは、新規登録を二重に準備しません。再ログインはサービス一覧から既存接続を開いてください。</p></div>
          <button type="button" className="bulk-primary-action" disabled={!profileReady || selected.length === 0 || busy} onClick={() => void start()}>{busy ? '登録画面を準備しています…' : `${selected.length}件の登録画面をまとめて準備`}</button>
          {!profileReady && <small className="bulk-disabled-reason">先に「01 共通情報」を準備完了にしてください</small>}
        </article>
      </section>

      {notice && <aside className={`bulk-result is-${notice.tone}`} role="status"><span aria-hidden="true">{notice.tone === 'ok' ? '✓' : '!'}</span><div><strong>{notice.title}</strong><p>{notice.text}</p></div><button type="button" onClick={() => setNotice(null)} aria-label="通知を閉じる">×</button></aside>}
    </main>
  );
}

function bulkErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'unsupported_provider') return '接続対象にできないサービスが含まれています。再読み込みして選び直してください。';
  if (code === 'missing_provider') return '少なくとも1件選択してください。';
  if (code === 'account_already_registered') return '選択したサービスはすでに接続済みです。二重登録を防ぐため、新規登録を停止しました。サービス一覧から既存接続を開いてください。';
  return '接続またはログイン状態を確認して、もう一度お試しください。';
}
