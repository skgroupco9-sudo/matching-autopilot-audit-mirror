'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { HubHeader } from '@/app/services/services-client';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';

type ImportResult = {
  imported: number;
  duplicates: number;
  skipped: number;
  truncated: number;
  totalMessages: number;
  imageAnalysis: 'not_requested' | 'completed' | 'ai_not_configured' | 'failed';
  imageSnippets: number;
};

type LearningResult = {
  learned: number;
  conversation: number;
  reports: number;
  ng: number;
  ignored: number;
  remainingPending: number;
  profile: { summary: string; model: string; updatedAt: string };
};

const errorMessages: Record<string, string> = {
  authentication_required: '続けるにはログインが必要です。',
  participant_consent_required: '参加者の同意確認にチェックしてください。',
  import_source_required: '履歴JSON・テキスト・画像のいずれかを選んでください。',
  invalid_telegram_json: 'TelegramのJSONを読み取れませんでした。result.jsonを選び直してください。',
  telegram_messages_not_found: 'このJSONにTelegramのメッセージ履歴が見つかりません。',
  history_file_too_large: '履歴ファイルは10MB以内にしてください。',
  image_too_large: '画像は1枚3MB以内にしてください。',
  too_many_images: '画像は1回3枚まで選択できます。',
  unsupported_image_type: '画像はJPEG・PNG・WebPに対応しています。',
  import_too_large: '一度に提出するファイルを合計16MB以内にしてください。',
  pasted_text_too_large: '貼り付けテキストは4万文字以内にしてください。',
};

const maximumAnalysisRuns = 50;

export function TelegramImportClient() {
  const fetchWithTimeout = useGuardedFetch();
  const [history, setHistory] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [consent, setConsent] = useState(false);
  const [autoLearn, setAutoLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [learningResult, setLearningResult] = useState<LearningResult | null>(null);
  const [learningError, setLearningError] = useState('');

  const hasSource = Boolean(history || images.length || pastedText.trim());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasSource || !consent || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    setLearningResult(null);
    setLearningError('');
    const formData = new FormData();
    if (history) formData.set('history', history);
    if (pastedText.trim()) formData.set('pastedText', pastedText.trim());
    for (const image of images) formData.append('images', image);
    formData.set('consent', String(consent));
    try {
      const response = await fetchWithTimeout('/api/telegram-learning/import', { method: 'POST', body: formData });
      const body = await response.json() as ImportResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'import_failed');
      setResult(body);
      if (autoLearn && (body.imported > 0 || body.duplicates > 0)) {
        const total: LearningResult = { learned: 0, conversation: 0, reports: 0, ng: 0, ignored: 0, remainingPending: 0, profile: { summary: '', model: '', updatedAt: '' } };
        for (let run = 0; run < maximumAnalysisRuns; run += 1) {
          const learningResponse = await fetchWithTimeout('/api/telegram-learning/analyze', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          const learningBody = await learningResponse.json() as LearningResult & { error?: string };
          if (!learningResponse.ok) {
            setLearningError(learningBody.error === 'ai_not_configured' ? 'GPT設定後に「報告・会話学習」から全件学習できます。' : '取込は完了しましたが、GPT学習だけ再実行が必要です。');
            break;
          }
          total.learned += learningBody.learned;
          total.conversation += learningBody.conversation;
          total.reports += learningBody.reports;
          total.ng += learningBody.ng;
          total.ignored += learningBody.ignored;
          total.remainingPending = learningBody.remainingPending;
          total.profile = learningBody.profile;
          if (learningBody.remainingPending <= 0) {
            setLearningResult(total);
            break;
          }
        }
        if (total.remainingPending > 0) setLearningError('取込は完了しましたが、残りのGPT学習を「報告・会話学習」から再開してください。');
      }
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'import_failed';
      setError(errorMessages[code] ?? '取り込めませんでした。内容と接続を確認して再試行してください。');
    } finally {
      setBusy(false);
    }
  };

  return <main className="hub-page learning-page import-page">
    <HubHeader current="learning" />
    <section className="import-hero">
      <div><span className="hub-eyebrow">CONSENTED HISTORY IMPORT</span><h1>会話履歴を、<br />安全に取り込む。</h1><p>同意済みのTelegram履歴・文章・マッチ相手との会話画像を提出すると、個人情報を除去し、GPTが会話・報告・NGへ分類して自然な文体へ統合します。生ファイルや画像は保存しません。</p></div>
      <ol aria-label="取込の流れ"><li><span>1</span><strong>提出</strong><small>JSON・テキスト・画像</small></li><li><span>2</span><strong>GPT解析</strong><small>本人と相手を分けて学習</small></li><li><span>3</span><strong>反映</strong><small>会話・報告・NGへ統合</small></li></ol>
    </section>

    <section className="import-workspace" aria-labelledby="import-title">
      <div className="import-guide">
        <span className="hub-eyebrow">EXPORT GUIDE</span><h2>Telegram Desktopから書き出す</h2>
        <ol><li><span>01</span><div><strong>設定 → 詳細設定</strong><p>「Telegramデータをエクスポート」を開きます。</p></div></li><li><span>02</span><div><strong>対象チャットを選択</strong><p>形式は「機械可読JSON」を選びます。</p></div></li><li><span>03</span><div><strong>result.jsonを提出</strong><p>複数チャット入りの書き出しにも対応します。</p></div></li></ol>
        <div className="import-data-rule"><strong>保存するもの</strong><p>匿名化済みの文章と分類・承認状態だけ</p><strong>保存しないもの</strong><p>元ファイル、画像、氏名、送信者ID、グループ名</p></div>
      </div>

      <form className="import-form" onSubmit={(event) => void submit(event)}>
        <div className="import-form-heading"><span className="hub-eyebrow">IMPORT</span><h2 id="import-title">履歴を提出</h2><p>どれか1つだけでも、組み合わせても使えます。</p></div>

        <label className={`import-file-card ${history ? 'is-selected' : ''}`}>
          <input type="file" accept=".json,.txt,application/json,text/plain" onChange={(event) => setHistory(event.target.files?.[0] ?? null)} />
          <span aria-hidden="true">{history ? '✓' : 'JSON'}</span><div><strong>{history ? history.name : '履歴JSON / テキスト'}</strong><small>{history ? formatBytes(history.size) : 'result.json または .txt・最大10MB'}</small></div><em>{history ? '選択済み' : '選ぶ'}</em>
        </label>

        <label className={`import-file-card ${images.length ? 'is-selected' : ''}`}>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImages(Array.from(event.target.files ?? []).slice(0, 3))} />
          <span aria-hidden="true">{images.length ? images.length : '画像'}</span><div><strong>{images.length ? `${images.length}枚の画像` : 'マッチ相手との会話画像'}</strong><small>{images.length ? images.map((image) => image.name).join('、') : '吹き出しから本人・相手を判定／不明は確認待ち'}</small></div><em>{images.length ? '選択済み' : '選ぶ'}</em>
        </label>

        <label className="import-text-field"><span>文章を直接貼り付け <small>任意</small></span><textarea value={pastedText} onChange={(event) => setPastedText(event.target.value)} maxLength={40_000} placeholder="参考にしたい会話や報告文を貼り付け" /><em>{pastedText.length.toLocaleString('ja-JP')} / 40,000</em></label>

        <label className="import-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span aria-hidden="true">✓</span><div><strong>参加者の同意を確認しました</strong><small>学習目的と提出範囲を参加者へ説明し、同意のある履歴だけを提出します。</small></div></label>

        <label className="import-consent import-auto-learn"><input type="checkbox" checked={autoLearn} onChange={(event) => setAutoLearn(event.target.checked)} /><span aria-hidden="true">GPT</span><div><strong>取込後、GPTで全件を自動学習</strong><small>会話の返し方・報告形式・NGを分類し、個人的事実を除いた文体プロファイルへ統合します。</small></div></label>

        {error ? <div className="import-notice is-error" role="alert"><span>!</span><p>{error}</p>{error.includes('ログイン') ? <Link href="/">ログインへ</Link> : null}</div> : null}
        {result ? <ImportResultCard result={result} learning={learningResult} learningError={learningError} /> : null}

        <button className="import-submit" type="submit" disabled={!hasSource || !consent || busy}><span>{busy ? autoLearn ? 'GPTが全部解析・学習しています…' : '安全に取り込んでいます…' : autoLearn ? '匿名化してGPTで全件学習' : '匿名化して確認待ちへ'}</span><i aria-hidden="true">→</i></button>
        <p className="import-form-footnote">GPTが会話生成の主軸です。本人が言っていない経歴・感情・約束は学習せず、自然な言葉遣いと会話の運び方だけを反映します。</p>
      </form>
    </section>
  </main>;
}

function ImportResultCard({ result, learning, learningError }: { result: ImportResult; learning: LearningResult | null; learningError: string }) {
  const imageMessage = result.imageAnalysis === 'completed'
    ? `画像から本人側の返信${result.imageSnippets}件を抽出しました。`
    : result.imageAnalysis === 'ai_not_configured'
      ? '画像解析にはAI設定が必要です。テキスト分は取り込み済みです。'
      : result.imageAnalysis === 'failed'
        ? '画像解析だけ完了しませんでした。テキスト分は取り込み済みです。'
        : '';
  return <div className="import-result" role="status"><span aria-hidden="true">✓</span><div><strong>{learning ? `${learning.learned}件のGPT学習が完了しました` : `${result.imported}件を取り込みました`}</strong><p>重複 {result.duplicates}件・対象外 {result.skipped}件{result.truncated ? `・上限超過 ${result.truncated}件` : ''}</p>{imageMessage ? <p>{imageMessage}</p> : null}{learning ? <p>会話 {learning.conversation}件・報告 {learning.reports}件・NG {learning.ng}件を統合しました。</p> : null}{learningError ? <p>{learningError}</p> : null}</div><Link href="/telegram-learning">学習状況を見る →</Link></div>;
}

function formatBytes(value: number) {
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)}KB` : `${(value / 1024 / 1024).toFixed(1)}MB`;
}
