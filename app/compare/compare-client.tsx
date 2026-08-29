'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { HubHeader } from '@/app/services/services-client';
import {
  rankJapaneseServices,
  type ComparisonAgeBand,
  type ComparisonGoal,
  type ComparisonPriority,
  type JapaneseServiceProfile,
} from '@/lib/japan-service-comparison';

const goals: Array<[ComparisonGoal, string, string]> = [
  ['relationship', '恋人を探す', 'まずは真剣な交際'],
  ['marriage', '結婚相手を探す', '結婚を見据えたい'],
  ['remarriage', '再婚を考える', '子育て・婚姻歴も重視'],
  ['companionship', '人生の相手', '縁活・穏やかな関係'],
];

const ageBands: Array<[ComparisonAgeBand, string]> = [['20s', '20代'], ['30s', '30代'], ['40s', '40代'], ['50plus', '50代以上']];
const priorities: Array<[ComparisonPriority, string, string]> = [
  ['least_work', '手間の少なさ', '公式AIを優先'],
  ['values', '価値観の一致', '内面・共通点を優先'],
  ['serious', '真剣度', '婚活設計を優先'],
];

export function CompareClient({ services }: { services: JapaneseServiceProfile[] }) {
  const [goal, setGoal] = useState<ComparisonGoal>('relationship');
  const [ageBand, setAgeBand] = useState<ComparisonAgeBand>('30s');
  const [priority, setPriority] = useState<ComparisonPriority>('least_work');
  const [browserOnly, setBrowserOnly] = useState(true);

  const ranked = useMemo(() => rankJapaneseServices({ goal, ageBand, priority, browserOnly })
    .filter((rankedService) => services.some((service) => service.id === rankedService.service.id)), [ageBand, browserOnly, goal, priority, services]);
  const top = ranked.slice(0, 3);
  const preparable = top.filter(({ service }) => service.matchPilotConnection === 'prepare').map(({ service }) => service.id);
  const officialNativeCount = services.filter((service) => service.externalAutomationStatus === 'official_native').length;
  const webCount = services.filter((service) => service.webAccess === 'available').length;

  return (
    <main className="hub-page compare-page">
      <HubHeader current="compare" />
      <section className="compare-hero">
        <div>
          <span className="hub-eyebrow">JAPAN SERVICE FIT CHECK</span>
          <h1>あなた向けを、<br />3つまで絞る。</h1>
          <p>広告の順位ではなく、目的・年代・手間・Web利用・本人確認・公式規約を同じ基準で比較します。外部自動操作が認められないサービスは、自動化できるとは表示しません。</p>
        </div>
        <div className="compare-audit-stats" aria-label="比較監査の集計">
          <span><strong>{services.length}</strong><small>公式比較</small></span>
          <span><strong>{webCount}</strong><small>Web確認</small></span>
          <span><strong>{officialNativeCount}</strong><small>公式AIいいね</small></span>
          <span><strong>0</strong><small>完全自動API</small></span>
        </div>
      </section>

      <section className="compare-config" aria-labelledby="compare-config-title">
        <header><div><span>01</span><div><h2 id="compare-config-title">希望を3つ選ぶ</h2><p>選択するたびに、公式確認済み候補を並べ替えます</p></div></div><b>約20秒</b></header>
        <fieldset className="compare-choice-group"><legend>目的</legend><div className="compare-goal-grid">{goals.map(([value, label, detail]) => <button key={value} type="button" className={goal === value ? 'is-active' : ''} onClick={() => setGoal(value)} aria-pressed={goal === value}><i aria-hidden="true">{goal === value ? '✓' : '○'}</i><span><strong>{label}</strong><small>{detail}</small></span></button>)}</div></fieldset>
        <fieldset className="compare-choice-group"><legend>あなたの年代</legend><div className="compare-segmented">{ageBands.map(([value, label]) => <button key={value} type="button" className={ageBand === value ? 'is-active' : ''} onClick={() => setAgeBand(value)} aria-pressed={ageBand === value}>{label}</button>)}</div></fieldset>
        <fieldset className="compare-choice-group"><legend>いちばん重視すること</legend><div className="compare-priority-grid">{priorities.map(([value, label, detail]) => <button key={value} type="button" className={priority === value ? 'is-active' : ''} onClick={() => setPriority(value)} aria-pressed={priority === value}><strong>{label}</strong><small>{detail}</small></button>)}</div></fieldset>
        <label className="compare-browser-toggle"><input type="checkbox" checked={browserOnly} onChange={(event) => setBrowserOnly(event.target.checked)} /><span><strong>ブラウザで使えるものを優先</strong><small>アプリ専用は候補順位を下げます</small></span><i aria-hidden="true" /></label>
      </section>

      <section className="compare-recommendations" aria-labelledby="recommendations-title">
        <header><div><span>02</span><div><h2 id="recommendations-title">今のおすすめ</h2><p>一致した理由と、自動化できない境界まで表示</p></div></div>{preparable.length > 0 && <Link href={`/accounts/new?providers=${preparable.join(',')}`}>準備できる候補を選択済みにする <span aria-hidden="true">→</span></Link>}</header>
        <div className="compare-top-grid">
          {top.map((result, index) => <ServiceComparisonCard key={result.service.id} service={result.service} rank={index + 1} reasons={result.reasons} featured={index === 0} />)}
        </div>
      </section>

      <section className="compare-all" aria-labelledby="compare-all-title">
        <header><div><h2 id="compare-all-title">比較した{services.length}サービス</h2><p>おすすめ以外も、同じ監査項目で確認できます</p></div><Link href="/services">113件の全一覧を見る <span aria-hidden="true">→</span></Link></header>
        <div className="compare-table" role="table" aria-label="日本のサービス比較表">
          <div className="compare-table-head" role="row"><span role="columnheader">サービス</span><span role="columnheader">主な対象</span><span role="columnheader">Web</span><span role="columnheader">自動化の境界</span><span role="columnheader">確認</span></div>
          {ranked.map(({ service }) => <div className="compare-table-row" role="row" key={service.id}><span role="cell"><strong>{service.label}</strong><small>{service.minimumAge}</small></span><span role="cell">{service.strengths[0]}</span><span role="cell"><i className={service.webAccess === 'available' ? 'is-ok' : ''}>{service.webAccess === 'available' ? 'Webあり' : 'アプリのみ'}</i></span><span role="cell"><AutomationBoundary service={service} /></span><span role="cell"><a href={service.evidenceUrl} target="_blank" rel="noreferrer" aria-label={`${service.label}の公式根拠を開く`}>公式 ↗</a></span></div>)}
        </div>
      </section>

      <section className="compare-boundaries" aria-label="自動化の監査結論">
        <article><span aria-hidden="true">✓</span><div><h2>すでにできる</h2><p>共通プロフィール、公式Web入口、AI下書き、会話ルール、本人判断、Telegram報告を一つにまとめます。</p></div></article>
        <article><span aria-hidden="true">A</span><div><h2>公式AIを優先</h2><p>Ravitのように公式サービス自身が自動いいねを提供する場合は、外部ブラウザ操作より公式機能を優先します。</p></div></article>
        <article className="is-warning"><span aria-hidden="true">!</span><div><h2>勝手に突破しない</h2><p>規約で禁止された巡回・自動投稿、CAPTCHA、本人確認、規約同意、課金確定は自動化しません。</p></div></article>
      </section>
    </main>
  );
}

function ServiceComparisonCard({ service, rank, reasons, featured }: { service: JapaneseServiceProfile; rank: number; reasons: string[]; featured: boolean }) {
  return (
    <article className={`compare-service-card ${featured ? 'is-featured' : ''}`}>
      <div className="compare-rank"><span>{rank === 1 ? 'BEST FIT' : `NO.${rank}`}</span><b>{String(rank).padStart(2, '0')}</b></div>
      <div className="compare-service-heading"><span aria-hidden="true">{Array.from(service.label)[0]}</span><div><h3>{service.label}</h3><AutomationBoundary service={service} /></div></div>
      <p className="compare-service-summary">{service.summary}</p>
      <ul className="compare-reasons">{reasons.length > 0 ? reasons.map((reason) => <li key={reason}>✓ {reason}</li>) : <li>条件を変えると適合理由を表示します</li>}</ul>
      <dl className="compare-facts"><div><dt>登録</dt><dd>{service.registration.slice(0, 3).join('・')}</dd></div><div><dt>本人操作</dt><dd>{service.identityStep}</dd></div></dl>
      <p className="compare-caution"><strong>注意</strong>{service.cautions[0]}</p>
      <div className="compare-card-actions"><a href={service.officialUrl} target="_blank" rel="noreferrer">公式サービスを開く <span aria-hidden="true">↗</span></a><a href={service.termsUrl} target="_blank" rel="noreferrer">規約</a></div>
    </article>
  );
}

function AutomationBoundary({ service }: { service: JapaneseServiceProfile }) {
  if (service.externalAutomationStatus === 'official_native') return <em className="automation-boundary is-native">公式AIいいね</em>;
  if (service.externalAutomationStatus === 'prohibited') return <em className="automation-boundary is-blocked">外部自動操作不可</em>;
  return <em className="automation-boundary is-unverified">外部自動許可未確認</em>;
}
