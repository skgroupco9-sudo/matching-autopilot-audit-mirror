import type { Metadata } from 'next';
import { LegalShell } from '@/app/legal-shell';
import { connectorDefinitions, serviceCatalogDefinitions } from '@/lib/automation/connectors';
import { engineeringReferenceSources, internalReferenceSources, japanServiceResearchSources, similarProductSources, type ReferenceSource } from '@/lib/reference-sources';

export const metadata: Metadata = {
  title: '設計ソースと比較調査',
  description: 'MatchPilotが参照した既存システム、世界の類似サービス、公式技術資料、サービス調査URLの一覧です。',
};

function SourceList({ sources }: { sources: ReferenceSource[] }) {
  return (
    <ol className="reference-list">
      {sources.map((source) => (
        <li key={source.name}>
          <div><strong>{source.name}</strong><span>{source.organization}</span></div>
          <p><b>採用・比較:</b> {source.adopted}</p>
          {source.boundary && <p><b>境界:</b> {source.boundary}</p>}
          {source.url && <a href={source.url} target="_blank" rel="noreferrer">一次ソースを開く ↗</a>}
        </li>
      ))}
    </ol>
  );
}

export default function SourcesPage() {
  return (
    <LegalShell title="設計ソースと比較調査" summary="この端末で過去に開発したシステムと、公開確認できた世界の類似製品・公式技術資料を、MatchPilotへどう反映したかまで公開します。">
      <section className="source-audit-summary">
        <h2>監査時点の結論</h2>
        <div><span><strong>{internalReferenceSources.length}</strong>既存システム</span><span><strong>{similarProductSources.length}</strong>類似製品</span><span><strong>{engineeringReferenceSources.length}</strong>公式技術資料</span><span><strong>{japanServiceResearchSources.length}</strong>国内公式比較</span><span><strong>{serviceCatalogDefinitions.length}</strong>サービス調査URL</span></div>
        <p>網羅性は「監査日に存在とURLを確認できた範囲」です。世界中の非公開・終了済み製品まで完全であるとは表示しません。新しい一次ソースは継続追加します。</p>
      </section>
      <section><h2>この端末で開発した既存システム</h2><p>コードや秘密情報を混ぜるのではなく、実績のある設計パターンだけを再利用しています。</p><SourceList sources={internalReferenceSources} /></section>
      <section><h2>世界の類似製品</h2><p>返信補助・プロフィール改善の代表例です。各社の自己申告は比較材料であり、成果保証として扱いません。</p><SourceList sources={similarProductSources} /></section>
      <section><h2>日本の主要サービス公式比較</h2><p>2026年8月28日時点の公式サイト・ヘルプ・利用規約を優先し、対象年代、Web利用、本人確認、公式AI、外部自動操作の境界を確認しました。</p><SourceList sources={japanServiceResearchSources} /></section>
      <section><h2>公式技術・安全性ソース</h2><SourceList sources={engineeringReferenceSources} /></section>
      <section>
        <h2>ブラウザ版 {connectorDefinitions.length}件の公開URL</h2>
        <p>「URL掲載」と「実機E2E検証済み」は別です。ログイン・候補取得・マッチ・返信送信・Telegram報告を完走するまで検証済みとは数えません。</p>
        <div className="service-source-grid">
          {connectorDefinitions.map((service) => <article key={service.id}><strong>{service.label}</strong><span>{service.externalAutomationStatus === 'prohibited' ? '規約確認済み・外部自動操作対象外' : service.supportStatus === 'catalog_only' ? '一覧・公式入口のみ' : service.automationTier === 'standard' ? '優先接続候補' : '汎用接続候補'}</span><a href={service.entryUrl} target="_blank" rel="noreferrer">公開Web入口 ↗</a>{service.termsUrl && <a href={service.termsUrl} target="_blank" rel="noreferrer">利用条件 ↗</a>}</article>)}
        </div>
      </section>
      <section>
        <h2>追加カタログの調査URL</h2>
        <p><a href="https://matching.hp.peraichi.com/" target="_blank" rel="noreferrer">ユーザー提供のマッチングアプリ一覧 ↗</a>も探索起点として参照し、各URLの現行提供・Web利用範囲・利用条件を個別に確認します。</p>
        <details className="catalog-source-details"><summary>{serviceCatalogDefinitions.length}件を表示</summary><ul>{serviceCatalogDefinitions.map((service) => <li key={`${service.id}-${service.entryUrl}`}><a href={service.entryUrl} target="_blank" rel="noreferrer">{service.label}</a> — {service.webStatus === 'available' ? 'Web入口あり' : service.webStatus === 'app_only' ? 'アプリ専用' : '調査中'}</li>)}</ul></details>
      </section>
    </LegalShell>
  );
}
