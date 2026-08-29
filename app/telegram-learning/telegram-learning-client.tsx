'use client';

import Link from 'next/link';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { HubHeader } from '@/app/services/services-client';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';

type LearningItem = {
  id: string;
  sourceKind: 'direct' | 'forwarded' | 'imported';
  category: 'unclassified' | 'report_example' | 'conversation_example' | 'ng_rule';
  status: 'pending' | 'ready' | 'approved' | 'rejected';
  text: string;
  createdAt: string;
  approvedAt: string | null;
};

type LearningAction = 'classify' | 'approve' | 'reject' | 'delete';

type LearningProfile = {
  summary: string;
  analyzedCount: number;
  model: string;
  updatedAt: string;
};

type AnalysisResult = {
  learned: number;
  classified: number;
  awaitingApproval: number;
  conversation: number;
  reports: number;
  ng: number;
  ignored: number;
  remainingPending: number;
  profile: { summary: string; model: string; updatedAt: string } | null;
};

const maximumAnalysisRuns = 50;
const learningPageSize = 20;

export function TelegramLearningClient() {
  const fetchWithTimeout = useGuardedFetch();
  const [items, setItems] = useState<LearningItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [profile, setProfile] = useState<LearningProfile | null>(null);
  const [safeApprovedCount, setSafeApprovedCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState<{ tone: 'ok' | 'error'; text: string; needsAi?: boolean } | null>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const deferredLibraryQuery = useDeferredValue(libraryQuery);
  const [statusFilter, setStatusFilter] = useState<'review' | 'approved' | 'all'>('review');
  const [categoryFilter, setCategoryFilter] = useState<'all' | LearningItem['category']>('all');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const response = await fetchWithTimeout('/api/telegram-learning', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (response.status === 401) return setState('login');
      if (!response.ok) throw new Error('load_failed');
      const result = await response.json() as { items: LearningItem[]; profile: LearningProfile | null; safeApprovedCount?: number };
      setItems(result.items);
      setProfile(result.profile);
      setSafeApprovedCount(result.safeApprovedCount ?? 0);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [fetchWithTimeout]);

  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  const analyzeAll = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalysisNotice(null);
    try {
      const total = { learned: 0, classified: 0, awaitingApproval: 0, conversation: 0, reports: 0, ng: 0, ignored: 0 };
      let remainingPending = Number.POSITIVE_INFINITY;
      for (let run = 0; run < maximumAnalysisRuns; run += 1) {
        const response = await fetchWithTimeout('/api/telegram-learning/analyze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        const body = await response.json() as AnalysisResult & { error?: string };
        if (response.status === 401) return setState('login');
        if (!response.ok) {
          if (body.error === 'ai_not_configured') {
            setAnalysisNotice({ tone: 'error', text: 'GPT設定が必要です。AI設定を完了すると全件学習できます。', needsAi: true });
            return;
          }
          throw new Error(body.error ?? 'analysis_failed');
        }
        total.learned = body.learned;
        total.classified += body.classified;
        total.awaitingApproval = body.awaitingApproval;
        total.conversation += body.conversation;
        total.reports += body.reports;
        total.ng += body.ng;
        total.ignored += body.ignored;
        remainingPending = body.remainingPending;
        if (remainingPending <= 0) break;
      }
      if (remainingPending > 0) throw new Error('analysis_runs_exhausted');
      setStatusFilter(total.awaitingApproval > 0 ? 'review' : 'approved');
      setAnalysisNotice({ tone: 'ok', text: `${total.classified}件を安全に分類しました。${total.awaitingApproval}件は確認待ちです。承認済み${total.learned}件だけをAI会話へ反映しています。` });
      await load();
    } catch {
      setAnalysisNotice({ tone: 'error', text: 'GPT解析を完了できませんでした。接続とAI設定を確認して再試行してください。' });
    } finally {
      setAnalyzing(false);
    }
  };

  const update = async (item: LearningItem, action: LearningAction, category?: 'report_example' | 'conversation_example' | 'ng_rule') => {
    if (busyId) return;
    setBusyId(item.id);
    setNotice('');
    try {
      const response = await fetchWithTimeout('/api/telegram-learning', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id: item.id, category }),
      });
      if (response.status === 401) return setState('login');
      if (!response.ok) throw new Error('update_failed');
      const destination = item.category === 'conversation_example' ? 'AI会話' : item.category === 'ng_rule' ? '報告とAI会話' : 'Telegram報告';
      setNotice(action === 'approve' ? `次回以降の${destination}へ反映しました。` : action === 'delete' ? '学習データを削除しました。' : '内容を更新しました。');
      await load();
    } catch {
      setNotice('更新できませんでした。もう一度お試しください。');
    } finally {
      setBusyId(null);
    }
  };

  const metrics = useMemo(() => ({
    report: items.filter((item) => item.status === 'approved' && item.category === 'report_example').length,
    conversation: items.filter((item) => item.status === 'approved' && item.category === 'conversation_example').length,
    ng: items.filter((item) => item.status === 'approved' && item.category === 'ng_rule').length,
    waiting: items.filter((item) => item.status === 'pending' || item.status === 'ready').length,
  }), [items]);

  const filteredItems = useMemo(() => {
    const query = deferredLibraryQuery.trim().toLocaleLowerCase('ja-JP');
    return items.filter((item) => {
      const statusMatches = statusFilter === 'all'
        || (statusFilter === 'review' && (item.status === 'pending' || item.status === 'ready'))
        || (statusFilter === 'approved' && item.status === 'approved');
      const categoryMatches = categoryFilter === 'all' || item.category === categoryFilter;
      const queryMatches = !query || item.text.toLocaleLowerCase('ja-JP').includes(query);
      return statusMatches && categoryMatches && queryMatches;
    });
  }, [categoryFilter, deferredLibraryQuery, items, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / learningPageSize));
  const visibleItems = filteredItems.slice((Math.min(page, pageCount) - 1) * learningPageSize, Math.min(page, pageCount) * learningPageSize);

  return <main className="hub-page learning-page">
    <HubHeader current="learning" />
    <section className="learning-hero">
      <div><span className="hub-eyebrow">PERSONAL STYLE MEMORY</span><h1>他のグループから、<br />報告と会話を学ぶ。</h1><p>参考にしたいメッセージだけを「L婚サポート２」へ転送。個人情報を伏せた下書きを確認し、承認した報告形式・会話例・NGだけをあなた専用ルールへ反映します。</p></div>
      <div className="learning-metrics" aria-label="学習状況"><Metric value={metrics.report} label="報告例" /><Metric value={metrics.conversation} label="会話例" /><Metric value={metrics.ng} label="NG" /><Metric value={metrics.waiting} label="確認待ち" /></div>
    </section>

    <section className="learning-flow" aria-labelledby="learning-flow-title"><div><span>01</span><strong id="learning-flow-title">メッセージを転送</strong><p>他グループの文章を長押しして「L婚サポート２」へ転送</p></div><i>→</i><div><span>02</span><strong>用途を選ぶ</strong><p>「報告例」「会話例」「NG」のどれかを選択</p></div><i>→</i><div><span>03</span><strong>反映を承認</strong><p>内容を確認し、承認した例だけを学習</p></div><a href="https://t.me/MatchPilotPersonalJPBot" target="_blank" rel="noreferrer">L婚サポート２を開く ↗</a></section>

    <section className="learning-source-note" aria-labelledby="learning-source-title"><span aria-hidden="true">↗</span><div><strong id="learning-source-title">同意済みの過去履歴も取り込めます</strong><p>Telegram Desktopの書き出しJSON、貼り付けた文章、画像を匿名化して確認待ちへ追加できます。Botがグループ全体を勝手に読み込むことはありません。</p></div><Link href="/telegram-learning/import">履歴を取り込む</Link></section>

    <section className={`learning-ai-panel ${profile || safeApprovedCount > 0 ? 'is-trained' : ''}`} aria-labelledby="learning-ai-title">
      <div className="learning-ai-copy"><div className="learning-ai-title-row"><span className="learning-ai-orb" aria-hidden="true">GPT</span><div><span className="hub-eyebrow">NATURAL LANGUAGE CORE</span><h2 id="learning-ai-title">GPTで分類、承認後に学習</h2></div><em>会話生成の主軸</em></div><p>登録済みの全件を10件ずつ安全に読み、会話・報告・NGへ自動分類します。AIは分類だけを行い、あなたが内容を確認して承認した例だけを自然な返信へ反映します。</p>
        <div className="learning-ai-features"><span><i>会</i><strong>会話スタイル</strong><small>相づち・距離感・質問</small></span><span><i>報</i><strong>報告スタイル</strong><small>順序・箇条書き・要約</small></span><span><i>守</i><strong>安全ルール</strong><small>NG・本人確認条件</small></span></div>
      </div>
      <div className="learning-ai-action">
        {profile ? <div className="learning-profile-summary"><span>承認済みだけ学習</span><strong>{profile.analyzedCount}件から統合</strong><p>{profile.summary}</p><small>{profile.model}・{formatDate(profile.updatedAt)}</small></div> : safeApprovedCount > 0 ? <div className="learning-profile-summary"><span>安全な承認例だけ反映中</span><strong>{safeApprovedCount}件を直接利用</strong><p>旧方式の統合プロファイルは使わず、安全判定を通った承認済み例だけを会話・報告へ反映しています。</p></div> : <div className="learning-profile-summary is-empty"><span>準備完了</span><strong>まず分類して確認</strong><p>GPTが用途を整理し、内容を確認待ちへ並べます。承認するまでAI会話には使いません。</p></div>}
        <button type="button" onClick={() => void analyzeAll()} disabled={analyzing || items.length === 0}><span>{analyzing ? 'GPTが安全に分類中…' : profile ? '最新履歴を分類・再統合' : safeApprovedCount > 0 ? '安全例を再統合' : 'GPTで全件を分類'}</span><i aria-hidden="true">→</i></button>
        {analysisNotice ? <div className={`learning-analysis-notice is-${analysisNotice.tone}`} role="status"><p>{analysisNotice.text}</p>{analysisNotice.needsAi ? <Link href="/worker-setup#ai-provider">GPTを設定</Link> : null}</div> : null}
      </div>
    </section>

    {state === 'loading' && <LearningState title="学習データを読み込んでいます" />}
    {state === 'login' && <LearningState title="ログインが必要です" text="Telegram報告学習はアカウントごとに保存されます。" action={<Link href="/">ログインへ</Link>} />}
    {state === 'error' && <LearningState title="読み込めませんでした" text="接続を確認して再試行してください。" action={<button type="button" onClick={() => void load()}>再読み込み</button>} />}
    {state === 'ready' && <section className="learning-library" aria-labelledby="learning-library-title">
      <header><div><span className="hub-eyebrow">LEARNING LIBRARY</span><h2 id="learning-library-title">学習メモリ</h2><p>{notice || '確認待ちを優先表示します。承認済みだけがAIへ反映されます。'}</p></div><button type="button" onClick={() => void load()}>更新</button></header>
      <div className="learning-library-tools">
        <label className="hub-search"><span aria-hidden="true">⌕</span><span className="sr-only">学習データを検索</span><input maxLength={160} value={libraryQuery} onChange={(event) => { setLibraryQuery(event.target.value); setPage(1); }} placeholder="文章を検索" /></label>
        <div className="hub-filter-row" role="group" aria-label="承認状況">{([['review', `確認待ち ${metrics.waiting}`], ['approved', `承認済み ${metrics.report + metrics.conversation + metrics.ng}`], ['all', 'すべて']] as const).map(([value, label]) => <button key={value} type="button" className={statusFilter === value ? 'is-active' : ''} onClick={() => { setStatusFilter(value); setPage(1); }} aria-pressed={statusFilter === value}>{label}</button>)}</div>
        <label className="hub-select"><span>用途</span><select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value as typeof categoryFilter); setPage(1); }}><option value="all">すべて</option><option value="conversation_example">会話例</option><option value="report_example">報告例</option><option value="ng_rule">NG</option><option value="unclassified">未分類</option></select></label>
      </div>
      {items.length === 0 && <div className="learning-empty"><span>↗</span><h3>まだ学習データはありません</h3><p>他のグループから、参考にしたい報告文・会話文・避けたい表現を「L婚サポート２」へ転送してください。</p><a href="https://t.me/MatchPilotPersonalJPBot" target="_blank" rel="noreferrer">最初の例を送る</a></div>}
      {items.length > 0 && filteredItems.length === 0 && <div className="learning-empty compact"><span>⌕</span><h3>該当する学習データがありません</h3><button type="button" onClick={() => { setLibraryQuery(''); setStatusFilter('all'); setCategoryFilter('all'); }}>絞り込みを解除</button></div>}
      <div className="learning-list">{visibleItems.map((item) => <article key={item.id} className={`learning-item is-${item.status}`}>
        <div className="learning-item-meta"><span className={`learning-kind is-${item.category}`}>{categoryLabel(item.category)}</span><span>{sourceLabel(item.sourceKind)}</span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div>
        <p>{item.text}</p>
        <div className="learning-item-actions">
          {item.status === 'pending' && <><button type="button" disabled={busyId === item.id} onClick={() => void update(item, 'classify', 'report_example')}>報告例</button><button type="button" disabled={busyId === item.id} onClick={() => void update(item, 'classify', 'conversation_example')}>会話例</button><button type="button" className="is-danger" disabled={busyId === item.id} onClick={() => void update(item, 'classify', 'ng_rule')}>NG</button><button type="button" className="is-quiet" disabled={busyId === item.id} onClick={() => void update(item, 'reject')}>使わない</button></>}
          {item.status === 'ready' && <><button type="button" className="is-primary" disabled={busyId === item.id} onClick={() => void update(item, 'approve')}>この内容を反映</button><button type="button" className="is-quiet" disabled={busyId === item.id} onClick={() => void update(item, 'reject')}>取り消す</button></>}
          {item.status === 'approved' && <><span className="learning-approved">✓ 学習済み</span><button type="button" className="is-quiet" disabled={busyId === item.id} onClick={() => void update(item, 'delete')}>削除</button></>}
          {item.status === 'rejected' && <><span className="learning-rejected">対象外</span><button type="button" className="is-quiet" disabled={busyId === item.id} onClick={() => void update(item, 'delete')}>削除</button></>}
        </div>
      </article>)}</div>
      {filteredItems.length > learningPageSize && <nav className="learning-pagination" aria-label="学習データのページ"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>前へ</button><span>{Math.min(page, pageCount)} / {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>次へ</button></nav>}
    </section>}

    <section className="learning-privacy"><span>⌁</span><div><strong>プライバシー保護</strong><p>メール、電話番号、認証番号、URL、Telegramユーザー名は保存前に自動で伏せます。画像・動画本体、転送元の氏名、グループ名は保存しません。安全上必要な停止・確認報告はNG学習で非表示にできません。</p></div></section>
  </main>;
}

function Metric({ value, label }: { value: number; label: string }) { return <span><strong>{value}</strong><small>{label}</small></span>; }
function categoryLabel(value: LearningItem['category']) { return value === 'report_example' ? '報告例' : value === 'conversation_example' ? '会話例' : value === 'ng_rule' ? 'NG' : '未分類'; }
function sourceLabel(value: LearningItem['sourceKind']) { return value === 'forwarded' ? '転送' : value === 'imported' ? '履歴取込' : '直接入力'; }
function formatDate(value: string) { return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function LearningState({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) { return <section className="learning-state"><span className="hub-spinner" /><h2>{title}</h2>{text && <p>{text}</p>}{action}</section>; }
