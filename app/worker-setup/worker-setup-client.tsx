'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { HubHeader } from '@/app/services/services-client';
import { defaultOpenAiModel } from '@/lib/ai-credentials';
import type { OpenAiProbeResult } from '@/lib/openai-connection';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';

type WorkerBinding = {
  workerId: string;
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AiSettings = {
  configured: boolean;
  enabled: boolean;
  keyHint: string | null;
  model: string;
  updatedAt: string | null;
};

export default function WorkerSetupClient({ userId }: { userId: string }) {
  const fetchWithTimeout = useGuardedFetch();
  const [bindings, setBindings] = useState<WorkerBinding[]>([]);
  const [workerId, setWorkerId] = useState('personal-windows-1');
  const [issuedToken, setIssuedToken] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [aiModel, setAiModel] = useState(defaultOpenAiModel);
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiProbe, setAiProbe] = useState<OpenAiProbeResult | null>(null);

  const load = useCallback(async () => {
    try {
      const [bindingResponse, aiResponse] = await Promise.all([
        fetchWithTimeout('/api/worker/bindings', { headers: { accept: 'application/json' }, cache: 'no-store' }),
        fetchWithTimeout('/api/ai-settings', { headers: { accept: 'application/json' }, cache: 'no-store' }),
      ]);
      if (!bindingResponse.ok || !aiResponse.ok) throw new Error('load_failed');
      const result = await bindingResponse.json() as { bindings: WorkerBinding[] };
      const nextAiSettings = await aiResponse.json() as AiSettings;
      setBindings(result.bindings);
      setAiSettings(nextAiSettings);
      setAiModel(nextAiSettings.model);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [fetchWithTimeout]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const issue = async () => {
    if (busyId || !workerId.trim()) return;
    setBusyId(workerId);
    setNotice('');
    setIssuedToken('');
    try {
      const response = await fetchWithTimeout('/api/worker/bindings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workerId }),
      });
      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token) throw new Error(result.error ?? 'issue_failed');
      setIssuedToken(result.token);
      setNotice('新しいトークンを発行しました。既存トークンとワーカー接続は無効になりました。');
      await load();
    } catch (error) {
      setNotice(error instanceof Error && error.message === 'worker_id_in_use'
        ? 'このワーカーIDは別のアカウントで使用されています。'
        : 'トークンを発行できませんでした。再試行してください。');
    } finally {
      setBusyId('');
    }
  };

  const saveAiSettings = async () => {
    if (aiBusy || aiTesting || !apiKey.trim()) return;
    setAiBusy(true);
    setNotice('');
    try {
      const response = await fetchWithTimeout('/api/ai-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), model: aiModel.trim(), enabled: true }),
      });
      const result = await response.json() as AiSettings & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'save_failed');
      setAiSettings(result);
      setApiKey('');
      setShowApiKey(false);
      setAiProbe(null);
      setNotice('AIキーを暗号化保存しました。常駐ワーカーへ1分以内に自動反映します。');
    } catch (error) {
      setNotice(error instanceof Error && error.message === 'invalid_openai_api_key'
        ? 'OpenAI APIキーの形式を確認してください。'
        : 'AI設定を保存できませんでした。再試行してください。');
    } finally {
      setAiBusy(false);
    }
  };

  const removeAiSettings = async () => {
    if (aiBusy || aiTesting || !window.confirm('保存中のAIキーを削除しますか？')) return;
    setAiBusy(true);
    setNotice('');
    try {
      const response = await fetchWithTimeout('/api/ai-settings', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('delete_failed');
      setAiSettings({ configured: false, enabled: false, keyHint: null, model: defaultOpenAiModel, updatedAt: null });
      setAiModel(defaultOpenAiModel);
      setApiKey('');
      setAiProbe(null);
      setNotice('保存していたAIキーを削除しました。');
    } catch {
      setNotice('AIキーを削除できませんでした。再試行してください。');
    } finally {
      setAiBusy(false);
    }
  };

  const testAiConnection = async () => {
    if (aiBusy || aiTesting || !aiSettings?.configured) return;
    setAiTesting(true);
    setNotice('');
    setAiProbe(null);
    try {
      const response = await fetchWithTimeout('/api/ai-settings/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const result = await response.json() as OpenAiProbeResult & { error?: string };
      if (!response.ok || typeof result.ok !== 'boolean') throw new Error(result.error ?? 'test_failed');
      setAiProbe(result);
      setNotice(result.ok ? 'OpenAIへの実接続に成功しました。AI返信を利用できます。' : result.detail);
    } catch {
      setNotice('AI実接続を確認できませんでした。再試行してください。');
    } finally {
      setAiTesting(false);
    }
  };

  const revoke = async (binding: WorkerBinding) => {
    if (busyId || !window.confirm(`${binding.workerId} の接続を無効にしますか？`)) return;
    setBusyId(binding.workerId);
    setNotice('');
    try {
      const response = await fetchWithTimeout('/api/worker/bindings', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workerId: binding.workerId }),
      });
      if (!response.ok) throw new Error('revoke_failed');
      setIssuedToken('');
      setNotice('ワーカー接続を無効にしました。');
      await load();
    } catch {
      setNotice('無効化できませんでした。再試行してください。');
    } finally {
      setBusyId('');
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label}をコピーしました。`);
    } catch {
      setNotice('コピーできませんでした。長押ししてコピーしてください。');
    }
  };

  return <main className="hub-page settings-hub-page">
    <HubHeader current="worker" />
    <section className="settings-hub-hero"><span className="hub-eyebrow">DEVICE TRUST</span><h1>ワーカーを、あなた専用に固定する。</h1><p>共有シークレットだけではなく、端末ごとのユーザー専用トークンで、取得できるプロフィール・認証情報・ジョブをこのアカウントに限定します。</p></section>

    {state === 'loading' && <section className="hub-state"><span className="hub-spinner" /><h1>認証状態を確認しています</h1></section>}
    {state === 'error' && <section className="hub-state"><h1>認証状態を読み込めませんでした</h1><button type="button" className="hub-state-action" onClick={() => void load()}>再読み込み</button></section>}
    {state === 'ready' && <div className="settings-form-grid worker-setup-grid">
      <section className="settings-panel span-2" id="ai-provider"><header><span>01</span><div><h2>AI返信を有効化</h2><p>APIキーは暗号化し、本人専用ワーカー以外へ表示しません</p></div></header>
        <div className="bulk-audit-answer"><span>現在の状態</span><strong>{aiSettings?.configured ? `設定済み ${aiSettings.keyHint ?? ''}` : '未設定'}</strong><p>{aiSettings?.configured ? 'キーそのものは再表示しません。実接続テストは最小量のAPIを使用します。' : '保存後はPCの設定ファイルを編集せずにAI返信を使えます。'}</p></div>
        {aiProbe ? <div className="bulk-audit-answer" role="status"><span>最新の実接続テスト</span><strong>{aiProbe.ok ? '利用可能' : '要確認'}</strong><p>{aiProbe.detail}{aiProbe.ok ? `（${aiProbe.model}・${aiProbe.latencyMs}ms）` : ''}</p></div> : null}
        <div className="two-column-fields"><label className="floating-field"><span>OpenAI APIキー</span><input type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} maxLength={256} placeholder="sk-…" autoComplete="off" spellCheck={false} /></label><label className="floating-field"><span>使用モデル</span><input value={aiModel} onChange={(event) => setAiModel(event.target.value)} maxLength={80} autoComplete="off" spellCheck={false} /></label></div>
        <div className="worker-inline-actions"><button type="button" onClick={() => setShowApiKey((current) => !current)}>{showApiKey ? 'キーを隠す' : '入力を表示'}</button><button type="button" className="hub-state-action" disabled={aiBusy || aiTesting || !apiKey.trim()} onClick={() => void saveAiSettings()}>{aiBusy ? '保存中…' : aiSettings?.configured ? '新しいキーへ更新' : '暗号化して保存'}</button>{aiSettings?.configured ? <button type="button" disabled={aiBusy || aiTesting} onClick={() => void testAiConnection()}>{aiTesting ? '実接続を確認中…' : 'AI実接続をテスト'}</button> : null}{aiSettings?.configured ? <button type="button" disabled={aiBusy || aiTesting} onClick={() => void removeAiSettings()}>保存キーを削除</button> : null}</div>
      </section>

      <section className="settings-panel span-2"><header><span>02</span><div><h2>この端末の認証を発行</h2><p>同じIDで再発行すると以前のトークンは即時無効になります</p></div></header><label className="floating-field"><span>ワーカーID</span><input value={workerId} onChange={(event) => setWorkerId(event.target.value)} maxLength={80} pattern="[A-Za-z0-9_-]+" autoComplete="off" /></label><div className="worker-value-row"><span><strong>WORKER_USER_ID</strong><code>{userId}</code></span><button type="button" onClick={() => void copy(userId, 'ユーザーID')}>コピー</button></div><button type="button" className="hub-state-action" disabled={Boolean(busyId) || !workerId.trim()} onClick={() => void issue()}>{busyId ? '発行中…' : '専用トークンを発行'}</button></section>

      {issuedToken && <section className="settings-panel span-2 worker-token-panel"><header><span>!</span><div><h2>今だけ表示しています</h2><p>WORKER_BINDING_TOKEN に設定後、この画面を閉じてください</p></div></header><div className="worker-value-row"><span><strong>WORKER_BINDING_TOKEN</strong><code>{issuedToken}</code></span><button type="button" onClick={() => void copy(issuedToken, 'トークン')}>コピー</button></div><p>この値はサーバーへ平文保存しません。紛失した場合は再発行してください。</p></section>}

      <section className="settings-panel span-2"><header><span>03</span><div><h2>登録済み端末</h2><p>使わない端末はすぐ無効化できます</p></div></header><div className="worker-binding-list">{bindings.map((binding) => <article key={binding.workerId}><span><strong>{binding.workerId}</strong><small>{binding.status === 'active' ? `最終認証 ${formatDate(binding.lastUsedAt)}` : '無効化済み'}</small></span><em className={binding.status === 'active' ? 'is-active' : ''}>{binding.status === 'active' ? '有効' : '無効'}</em>{binding.status === 'active' && <button type="button" disabled={busyId === binding.workerId} onClick={() => void revoke(binding)}>{busyId === binding.workerId ? '処理中…' : '無効化'}</button>}</article>)}{bindings.length === 0 && <p className="worker-empty">登録済み端末はありません。</p>}</div></section>
    </div>}

    {notice && <div className="hub-notice is-ok worker-notice" role="status"><span>{notice}</span></div>}
    <div className="worker-setup-footer"><Link href="/?view=settings#worker-title">設定へ戻る</Link><Link href="/support#worker-recovery">起動手順を見る</Link></div>
  </main>;
}

function formatDate(value: string | null) {
  if (!value) return 'まだ接続されていません';
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
