'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ServiceCatalogDefinition } from '@/lib/automation/types';
import type { DashboardPayload } from '@/lib/dashboard-types';
import { ThemeToggle } from '@/app/theme-toggle';
import { marriageAppPolicyTier } from '@/lib/automation/marriage-policy';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';

type Filter = 'recommended' | 'conditional' | 'prohibited' | 'all' | 'ready' | 'web' | 'app' | 'research' | 'ended';

const statusCopy = {
  connected: '接続済み',
  paused: '停止中',
  expired: '再ログイン',
  needs_verification: 'ログイン待ち',
  error: '要確認',
} as const;

export function ServicesClient({ services }: { services: ServiceCatalogDefinition[] }) {
  const fetchWithTimeout = useGuardedFetch();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<Filter>('recommended');
  const [category, setCategory] = useState('すべて');
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void fetchWithTimeout('/api/dashboard', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(async (response) => response.ok ? setDashboard(await response.json() as DashboardPayload) : undefined)
      .catch(() => undefined);
  }, [fetchWithTimeout]);

  const categories = useMemo(() => ['すべて', ...Array.from(new Set(services.map((service) => service.category)))], [services]);
  const connections = useMemo(() => new Map(dashboard?.connections.map((connection) => [connection.provider, connection]) ?? []), [dashboard]);
  const counts = useMemo(() => ({
    total: services.length,
    ready: services.filter((service) => service.supportStatus === 'assisted').length,
    recommended: services.filter((service) => marriageAppPolicyTier(service.id) === 'recommended').length,
    conditional: services.filter((service) => marriageAppPolicyTier(service.id) === 'conditional').length,
  }), [services]);
  const filtered = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase('ja-JP');
    return services.filter((service) => {
      const matchesQuery = !normalized || `${service.label} ${service.category} ${service.registrationMethods.join(' ')}`.toLocaleLowerCase('ja-JP').includes(normalized);
      const matchesCategory = category === 'すべて' || service.category === category;
      const matchesFilter = filter === 'all'
        || (filter === 'recommended' && marriageAppPolicyTier(service.id) === 'recommended')
        || (filter === 'conditional' && marriageAppPolicyTier(service.id) === 'conditional')
        || (filter === 'prohibited' && marriageAppPolicyTier(service.id) === 'prohibited')
        || (filter === 'ready' && service.supportStatus === 'assisted')
        || (filter === 'web' && service.webStatus === 'available' && service.availabilityStatus === 'active')
        || (filter === 'app' && service.webStatus === 'app_only' && service.availabilityStatus === 'active')
        || (filter === 'research' && service.availabilityStatus === 'research')
        || (filter === 'ended' && service.availabilityStatus === 'ended');
      return matchesQuery && matchesCategory && matchesFilter;
    });
  }, [category, deferredQuery, filter, services]);

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current);
  };

  const prepare = async (intent: 'existing' | 'new') => {
    if (!selected.length || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetchWithTimeout('/api/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'connection.addMany', providers: selected, connectionIntent: intent }),
      });
      if (response.status === 401) {
        setNotice({ tone: 'error', text: '続けるにはログインが必要です。' });
        return;
      }
      if (!response.ok) throw new Error('prepare_failed');
      setNotice({ tone: 'ok', text: `${selected.length}件の${intent === 'new' ? '登録' : 'ログイン'}準備を開始しました。` });
      setSelected([]);
      const dashboardResponse = await fetchWithTimeout('/api/dashboard', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (dashboardResponse.ok) setDashboard(await dashboardResponse.json() as DashboardPayload);
    } catch {
      setNotice({ tone: 'error', text: '開始できませんでした。接続を確認して再試行してください。' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="hub-page">
      <HubHeader current="services" />
      <section className="hub-hero hub-hero-apps">
        <div><span className="hub-eyebrow">WEB SERVICE DIRECTORY</span><h1>公式入口を、<br />一つの運転席へ。</h1><p>アプリ専用はブラウザ操作の対象外。公式Web・登録方法・外部自動操作の可否を分け、許可を確認できる範囲だけを接続準備します。</p><div className="hub-hero-action-row"><Link href="/compare" className="hub-hero-cta">自分向けを比較 <span aria-hidden="true">→</span></Link><Link href="/accounts/new" className="hub-hero-text-link">一括準備</Link></div></div>
        <div className="hub-metrics" aria-label="サービス集計"><Metric value={counts.recommended} label="推奨" /><Metric value={counts.conditional} label="条件付き" /><Metric value={counts.ready} label="登録準備候補" /><Metric value={counts.total} label="総掲載" /></div>
      </section>

      <section className="catalog-controls" aria-label="サービスを絞り込む">
        <label className="hub-search"><span aria-hidden="true">⌕</span><span className="sr-only">アプリ名を検索</span><input maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="アプリ名・登録方法を検索" /></label>
        <div className="hub-filter-row" role="group" aria-label="対応状況">
          {([['recommended', '推奨'], ['conditional', '条件付き'], ['ready', '登録準備可'], ['web', 'Web版'], ['all', 'すべて'], ['prohibited', '禁止'], ['app', 'アプリのみ'], ['research', '確認中'], ['ended', '終了']] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}
        </div>
        <label className="hub-select"><span>カテゴリ</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      </section>

      {notice && <div className={`hub-notice is-${notice.tone}`} role="status"><span>{notice.text}</span>{notice.tone === 'error' && <Link href="/">ログインへ</Link>}</div>}

      <div className="service-catalog-heading"><div><strong>{filtered.length}</strong><span>件を表示</span></div><p>最大5件を選ぶと一括でログイン・登録準備できます</p></div>
      <section className="service-grid" aria-live="polite">
        {filtered.map((service) => {
          const connection = connections.get(service.id);
          const policyTier = marriageAppPolicyTier(service.id);
          const canPrepare = policyTier !== 'prohibited' && service.supportStatus === 'assisted' && service.availabilityStatus === 'active';
          const isSelected = selected.includes(service.id);
          const launchLabel = service.webStatus === 'available' ? 'ログインして開く' : service.webStatus === 'app_only' ? 'アプリ案内を開く' : 'サービス情報を見る';
          return <article key={service.id} className={`service-launch-card ${isSelected ? 'is-selected' : ''} ${service.availabilityStatus === 'ended' ? 'is-ended' : ''} ${policyTier === 'prohibited' ? 'is-prohibited' : ''}`}>
            <div className="service-card-top"><span className="service-monogram" aria-hidden="true">{Array.from(service.label)[0]}</span><div><h2>{service.label}</h2><p>{service.category}</p></div>{connection && <span className={`connection-pill is-${connection.status}`}>{statusCopy[connection.status]}</span>}</div>
            <div className="service-badges">{policyTier === 'recommended' && <span className="is-positive">あなたの推奨</span>}{policyTier === 'conditional' && <span>40歳以上・年収600万円以上</span>}{policyTier === 'prohibited' && <span className="is-negative">あなたの禁止</span>}<span className={service.availabilityStatus === 'active' ? 'is-positive' : service.availabilityStatus === 'ended' ? 'is-negative' : ''}>{service.availabilityStatus === 'active' ? '提供中' : service.availabilityStatus === 'ended' ? '提供終了' : '提供状況を確認中'}</span><span className={service.webStatus === 'available' ? 'is-positive' : ''}>{service.webStatus === 'available' ? 'Web版' : service.webStatus === 'app_only' ? 'アプリ専用・対象外' : 'Web未確認'}</span>{service.externalAutomationStatus === 'official_native' && <span className="is-positive">公式AI補助</span>}{service.externalAutomationStatus === 'prohibited' && <span className="is-negative">外部自動操作不可</span>}{canPrepare && <span className="is-positive">{service.automationTier === 'standard' ? '接続準備・優先' : '接続準備・汎用'}</span>}</div>
            <p className="service-limitation">{service.limitation}</p>
            <details className="service-requirements"><summary>登録に必要なもの</summary><p>{service.minimumSetupFields.join('・')}</p></details>
            <div className="service-card-actions"><a href={service.entryUrl} target="_blank" rel="noreferrer" className="launch-button">{launchLabel}<span aria-hidden="true">↗</span></a>{canPrepare && <button type="button" className="select-service-button" onClick={() => toggle(service.id)} aria-pressed={isSelected}>{isSelected ? '選択済み ✓' : '一括準備に追加'}</button>}</div>
          </article>;
        })}
      </section>
      {filtered.length === 0 && <div className="hub-empty"><span>⌕</span><h2>該当するアプリがありません</h2><button type="button" onClick={() => { setQuery(''); setFilter('recommended'); setCategory('すべて'); }}>条件をリセット</button></div>}

      <section className="catalog-sources"><h2>接続と自動化の扱い</h2><p>「接続準備」は完全自動を意味しません。公式Web入口と共通情報を準備し、外部自動操作の許可・画面の一意判定・本人の会話ルールをすべて満たす範囲だけを進めます。規約で禁止された巡回・自動投稿、認証コード、CAPTCHA、本人確認、規約同意、課金確定は操作しません。</p><div><Link href="/compare">日本の主要サービス比較 →</Link><a href="https://matching.hp.peraichi.com/" target="_blank" rel="noreferrer">ユーザー提供一覧 ↗</a><a href="https://app.or.jp/?page_id=1695" target="_blank" rel="noreferrer">国内サービス索引 ↗</a></div></section>

      {selected.length > 0 && <aside className="selection-dock" aria-label="選択したアプリの準備"><div><strong>{selected.length}<span>/5件</span></strong><p>{selected.map((id) => services.find((service) => service.id === id)?.label).filter(Boolean).join('、')}</p></div><div><button type="button" disabled={busy} onClick={() => void prepare('existing')}>ログイン準備</button><button type="button" className="is-primary" disabled={busy} onClick={() => void prepare('new')}>{busy ? '開始中…' : '新規登録準備'}</button></div></aside>}
    </main>
  );
}

export function HubHeader({ current }: { current: 'compare' | 'services' | 'accounts' | 'preferences' | 'rules' | 'learning' | 'worker' | 'security' }) {
  return <header className="hub-header"><Link href="/" className="hub-logo"><span>M</span><strong>MatchPilot</strong></Link><nav aria-label="主要メニュー"><Link href="/compare" aria-current={current === 'compare' ? 'page' : undefined}>比較</Link><Link href="/services" aria-current={current === 'services' ? 'page' : undefined}>アプリ一覧</Link><Link href="/accounts/new" aria-current={current === 'accounts' ? 'page' : undefined}>一括準備</Link><Link href="/preferences" aria-current={current === 'preferences' ? 'page' : undefined}>マッチ条件</Link><Link href="/rules" aria-current={current === 'rules' ? 'page' : undefined}>会話ルール</Link></nav><div className="hub-header-actions"><ThemeToggle /><Link href="/" className="hub-account">管理画面</Link></div></header>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}
