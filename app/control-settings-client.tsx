'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { DashboardPayload, DashboardRule } from '@/lib/dashboard-types';
import { fixedOperationalSafeguards, prohibitedEvasionMethods, SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER } from '@/lib/automation/operational-safety';
import { HubHeader } from '@/app/services/services-client';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';
import { unicodeLength } from '@/lib/unicode-text';

type Mode = 'preferences' | 'rules';
type Draft = Omit<DashboardRule, 'preferredLocations' | 'requiredProfileKeywords' | 'excludedProfileKeywords' | 'topics' | 'blockedTopics' | 'goalKeywords' | 'forbiddenPhrases' | 'escalationTriggers'> & {
  preferredLocations: string;
  requiredProfileKeywords: string;
  excludedProfileKeywords: string;
  topics: string;
  blockedTopics: string;
  goalKeywords: string;
  forbiddenPhrases: string;
  escalationTriggers: string;
};

const defaults: Draft = {
  minAge: 30,
  maxAge: 70,
  radiusKm: 30,
  topics: '旅行、食事、映画、休日',
  blockedTopics: '金銭、投資、宗教、認証コード',
  minimumConfidence: 85,
  automationMode: 'full_auto',
  requireApprovalForScheduling: true,
  requireApprovalForContactExchange: false,
  contactExchangeDirection: 'receive_only',
  requiredConversationFields: ['marriage_intent', 'line_contact'],
  goalKeywords: '相手が婚活意思を明示した、相手からLINEを受領した',
  goalTarget: 5,
  preferredLocations: '',
  requiredProfileKeywords: '',
  excludedProfileKeywords: '勧誘、投資、既婚',
  desiredRelationship: '結婚を希望する相手と、真剣な婚活を進める',
  conversationTone: 'natural',
  replyLength: 'balanced',
  questionFrequency: 'balanced',
  persona: '',
  forbiddenPhrases: '',
  escalationTriggers: '金銭の話、本人確認情報、強い勧誘',
};

export function ControlSettingsClient({ mode }: { mode: Mode }) {
  const fetchWithTimeout = useGuardedFetch();
  const [draft, setDraft] = useState<Draft>(defaults);
  const [state, setState] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [savedSignature, setSavedSignature] = useState(() => JSON.stringify(defaults));
  const draftSignature = useMemo(() => JSON.stringify(draft), [draft]);
  const hasUnsavedChanges = draftSignature !== savedSignature;

  useEffect(() => {
    void fetchWithTimeout('/api/dashboard', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) return setState('login');
        if (!response.ok) return setState('error');
        const result = await response.json() as DashboardPayload;
        const nextDraft = toDraft(result.rule);
        setDraft(nextDraft);
        setSavedSignature(JSON.stringify(nextDraft));
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [fetchWithTimeout]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [hasUnsavedChanges]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setNotice('');
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const applyPreset = (preset: string) => {
    setDraft((current) => presetDraft(current, mode, preset));
    setNotice('おすすめ設定を反映しました。内容を確認して保存してください。');
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setNotice('');
    try {
      const response = await fetchWithTimeout('/api/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'rule.save',
          ...draft,
          topics: split(draft.topics),
          blockedTopics: split(draft.blockedTopics),
          goalKeywords: split(draft.goalKeywords),
          preferredLocations: split(draft.preferredLocations),
          requiredProfileKeywords: split(draft.requiredProfileKeywords),
          excludedProfileKeywords: split(draft.excludedProfileKeywords),
          forbiddenPhrases: split(draft.forbiddenPhrases),
          escalationTriggers: split(draft.escalationTriggers),
        }),
      });
      if (response.status === 401) return setState('login');
      if (!response.ok) throw new Error('save_failed');
      setSavedSignature(draftSignature);
      setNotice(mode === 'preferences' ? 'マッチング条件を保存しました。次の候補取得から反映されます。' : 'AI会話ルールを保存しました。次の返信案から反映されます。');
    } catch {
      setNotice('保存できませんでした。接続を確認して再試行してください。');
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading') return <main className="hub-page"><HubHeader current={mode} /><HubState title="設定を読み込んでいます" busy /></main>;
  if (state === 'login') return <main className="hub-page"><HubHeader current={mode} /><HubState title="ログインが必要です" text="この設定はアカウントごとに保存されます。" action={<Link href="/" className="hub-state-action">ログインへ</Link>} /></main>;
  if (state === 'error') return <main className="hub-page"><HubHeader current={mode} /><HubState title="設定を読み込めませんでした" text="時間を置いて再読み込みしてください。" action={<button type="button" className="hub-state-action" onClick={() => window.location.reload()}>再読み込み</button>} /></main>;

  return <main className="hub-page settings-hub-page">
    <HubHeader current={mode} />
    <section className="settings-hub-hero"><span className="hub-eyebrow">{mode === 'preferences' ? 'MATCH FILTER' : 'CONVERSATION BRAIN'}</span><h1>{mode === 'preferences' ? '会いたい相手だけに絞る。' : 'AIに、あなたの会話方針を教える。'}</h1><p>{mode === 'preferences' ? '年齢だけでなく、地域・距離・プロフィールの必須条件と除外条件をまとめて設定します。' : '固定文を繰り返すのではなく、相手の文脈に合わせながら、ここで決めた口調・範囲・禁止事項を守ります。'}</p></section>

    <section className="smart-presets" aria-labelledby="smart-presets-title">
      <div><span className="hub-eyebrow">ONE TAP</span><h2 id="smart-presets-title">迷ったら、おまかせ設定</h2><p>あとから細かく直せます。押しただけでは保存されません。</p></div>
      <div>{presetOptions(mode).map((preset) => <button key={preset.id} type="button" onClick={() => applyPreset(preset.id)}><strong>{preset.label}</strong><span>{preset.detail}</span>{preset.recommended && <em>おすすめ</em>}</button>)}</div>
    </section>

    {mode === 'preferences' ? <PreferencesForm draft={draft} update={update} /> : <RulesForm draft={draft} update={update} />}

    <div className={`settings-save-dock ${hasUnsavedChanges ? 'has-changes' : ''}`}><div><strong>{mode === 'preferences' ? 'マッチング条件' : 'AI会話ルール'}</strong><p role="status">{notice || (hasUnsavedChanges ? '未保存の変更があります。' : '保存済みです。全接続アプリに適用されます。')}</p></div><button type="button" disabled={saving || !hasUnsavedChanges} onClick={() => void save()}>{saving ? '保存中…' : hasUnsavedChanges ? '変更を保存' : '保存済み'}</button></div>
  </main>;
}

function PreferencesForm({ draft, update }: FormProps) {
  return <div className="settings-form-grid">
    <section className="settings-panel"><header><span>01</span><div><h2>年齢と距離</h2><p>年齢は婚活ルールの30〜70歳で固定です</p></div></header><div className="age-range-fields"><label><span>最小年齢</span><input type="number" value={30} readOnly aria-label="最小年齢 30歳 固定" /></label><i>〜</i><label><span>最大年齢</span><input type="number" value={70} readOnly aria-label="最大年齢 70歳 固定" /></label></div><label className="range-setting"><span><strong>検索距離</strong><output>{draft.radiusKm ?? 30}km以内</output></span><input type="range" min="1" max="200" step="1" value={draft.radiusKm ?? 30} onChange={(event) => update('radiusKm', Number(event.target.value))} /></label></section>
    <section className="settings-panel"><header><span>02</span><div><h2>地域</h2><p>複数指定は「、」で区切ります</p></div></header><label className="floating-field"><span>希望地域</span><textarea maxLength={800} value={draft.preferredLocations} onChange={(event) => update('preferredLocations', event.target.value)} placeholder="東京都、横浜市、埼玉県南部" /></label><div className="quick-chips"><span>クイック入力</span>{['東京都', '神奈川県', '千葉県', '埼玉県'].map((place) => <button key={place} type="button" onClick={() => update('preferredLocations', appendItem(draft.preferredLocations, place))}>{place}</button>)}</div></section>
    <section className="settings-panel span-2"><header><span>03</span><div><h2>プロフィール条件</h2><p>必須は一つ以上に一致、除外は一つでも一致すると候補外</p></div></header><div className="two-column-fields"><label className="floating-field"><span>含めたいキーワード</span><textarea maxLength={1600} value={draft.requiredProfileKeywords} onChange={(event) => update('requiredProfileKeywords', event.target.value)} placeholder="旅行、カフェ、犬、アウトドア" /></label><label className="floating-field is-danger"><span>除外キーワード</span><textarea maxLength={1600} value={draft.excludedProfileKeywords} onChange={(event) => update('excludedProfileKeywords', event.target.value)} placeholder="勧誘、投資、既婚" /></label></div></section>
    <section className="settings-panel span-2"><header><span>04</span><div><h2>関係性の目的</h2><p>会話AIの前提とTelegram報告に使います</p></div></header><label className="floating-field"><span>希望する関係性</span><textarea value={draft.desiredRelationship} onChange={(event) => update('desiredRelationship', event.target.value)} maxLength={120} placeholder="まずは食事から、価値観が合えば真剣な交際へ進みたい" /><small>{unicodeLength(draft.desiredRelationship)}/120</small></label></section>
  </div>;
}

function RulesForm({ draft, update }: FormProps) {
  return <div className="settings-form-grid">
    <section className="settings-panel span-2 conversation-protocol-card"><header><span>必須</span><div><h2>婚活・連絡先受領フロー</h2><p>この7条件は全自動でも変更されない固定ルールです</p></div></header><div className="protocol-checks"><p><strong>✓ 婚活意思を確認</strong><span>相手本人が結婚相手を探していると明示するまで達成扱いにしません。</span></p><p><strong>✓ 文面は毎回新規生成</strong><span>直近24件をAIへ渡し、過去に送った文章と完全一致する返信は送信しません。</span></p><p><strong>✓ 外部連絡先はこちらから求めない</strong><span>相手が自発的に共有した場合だけ受領・判定します。</span></p><p><strong>✓ 直接語・隠語とも送信禁止</strong><span>「LINE」「ライン」「緑のやつ」等を返信に含めず、検知回避の言い換えもしません。</span></p><p><strong>✓ 自分の連絡先は送信禁止</strong><span>AI生成後にも機械判定し、こちらのID・URL・QRは送信しません。</span></p><p><strong>✓ 受領後は36〜48時間でブロック</strong><span>受領直後にTelegramへ報告し、アプリ内返信を終了。36時間未満と48時間超過ではブロックせず、対応NGとして記録します。</span></p><p><strong>✓ 過去獲得者を除外</strong><span>全アプリ横断で照合し、候補・いいね・再マッチ・会話を止めます。</span></p></div></section>
    <section className="settings-panel span-2 operational-safety-card"><header><span>固定</span><div><h2>正規運用ガード</h2><p>凍結ゼロは保証せず、各サービスの規約と公式機能を優先します</p></div></header><div className="operational-safety-grid">{fixedOperationalSafeguards.map((item) => <article key={item.id}><span aria-hidden="true">✓</span><p><strong>{item.title}</strong><small>{item.detail}</small></p></article>)}</div><details className="prohibited-evasion-list"><summary>実行しない回避操作</summary><ul>{prohibitedEvasionMethods.map((method) => <li key={method}>{method}</li>)}</ul></details></section>
    <section className="settings-panel span-2"><header><span>00</span><div><h2>自動運転レベル</h2><p>サービス提供者から許可された接続だけに適用します</p></div></header><div className="choice-cards three automation-mode-cards">{([['full_auto', '許可済みのみ全自動', '明示的に許可された接続で条件判定→返信→報告'], ['approval', '確認して送信', '返信案をTelegramで確認してから送信'], ['draft_only', '下書きのみ', '文章を作るだけで外部へは送信しない']] as const).map(([value, title, text]) => <button key={value} type="button" className={draft.automationMode === value ? 'is-active' : ''} onClick={() => update('automationMode', value)} aria-pressed={draft.automationMode === value}><strong>{title}</strong><span>{text}</span></button>)}</div>{draft.automationMode === 'full_auto' && <p className="automation-mode-note"><strong>許可済み全自動ON</strong> 1サービス1日{SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER}人まで。外部自動操作が禁止・未許可のサービスでは実行しません。禁止話題・低確信度・認証・日程確定では送信せずTelegramへ戻します。</p>}</section>
    <section className="settings-panel span-2"><header><span>01</span><div><h2>会話の人格</h2><p>相手に合わせつつ、軸になる雰囲気を選びます</p></div></header><div className="choice-cards four">{([['natural', '自然体', '相手の温度感に合わせる'], ['friendly', '親しみやすい', '明るく柔らかい'], ['calm', '落ち着いた', '余裕のある短い文'], ['polite', '丁寧', '礼儀を優先する']] as const).map(([value, title, text]) => <button key={value} type="button" className={draft.conversationTone === value ? 'is-active' : ''} onClick={() => update('conversationTone', value)}><strong>{title}</strong><span>{text}</span></button>)}</div><label className="floating-field mt-field"><span>あなたらしさ・事実</span><textarea value={draft.persona} onChange={(event) => update('persona', event.target.value)} maxLength={1200} placeholder="休日はカフェや温泉。返信は絵文字を1つ程度。知らないことは知ったふりをしない。" /><small>{unicodeLength(draft.persona)}/1200</small></label></section>
    <section className="settings-panel"><header><span>02</span><div><h2>返信のリズム</h2><p>内容に応じて範囲内で調整します</p></div></header><Segmented label="返信量" value={draft.replyLength} options={[['short', '短め'], ['balanced', '標準'], ['detailed', '丁寧']]} onChange={(value) => update('replyLength', value as Draft['replyLength'])} /><Segmented label="質問頻度" value={draft.questionFrequency} options={[['low', '控えめ'], ['balanced', '自然'], ['high', '毎回寄り']]} onChange={(value) => update('questionFrequency', value as Draft['questionFrequency'])} /><label className="range-setting"><span><strong>自動判断の確信度</strong><output>{draft.minimumConfidence}%</output></span><input type="range" min="70" max="99" value={draft.minimumConfidence} onChange={(event) => update('minimumConfidence', Number(event.target.value))} /></label></section>
    <section className="settings-panel"><header><span>03</span><div><h2>話してよい範囲</h2><p>相手の話題には柔軟に返し、外側は確認へ</p></div></header><label className="floating-field"><span>会話してよいテーマ</span><textarea maxLength={1600} value={draft.topics} onChange={(event) => update('topics', event.target.value)} placeholder="旅行、食事、仕事、趣味、休日" /></label><label className="floating-field is-danger"><span>禁止テーマ</span><textarea maxLength={1600} value={draft.blockedTopics} onChange={(event) => update('blockedTopics', event.target.value)} placeholder="金銭、投資、宗教、認証コード" /></label></section>
    <section className="settings-panel"><header><span>04</span><div><h2>言わないこと</h2><p>固定の外部連絡先表現に加え、ここで指定した文も送信しません</p></div></header><label className="floating-field is-danger"><span>追加の禁止表現</span><textarea maxLength={2000} value={draft.forbiddenPhrases} onChange={(event) => update('forbiddenPhrases', event.target.value)} placeholder="絶対会おう、運命だね、本人確認コードを教えて" /></label></section>
    <section className="settings-panel"><header><span>05</span><div><h2>あなたへ戻す条件</h2><p>該当時はAIが決めず、Telegramで確認します</p></div></header><label className="floating-field"><span>判断を戻す話題・状況</span><textarea maxLength={2000} value={draft.escalationTriggers} onChange={(event) => update('escalationTriggers', event.target.value)} placeholder="金銭の話、本人確認情報、強い勧誘、体調不良" /></label><div className="toggle-stack"><Toggle checked={draft.requireApprovalForScheduling} onChange={(value) => update('requireApprovalForScheduling', value)} title="日程・場所の確定" /></div></section>
    <section className="settings-panel span-2"><header><span>06</span><div><h2>達成条件と報告</h2><p>条件達成時にプロフィール・要約・スクリーンショットをTelegramへ</p></div></header><div className="two-column-fields"><label className="floating-field"><span>達成とみなす条件</span><textarea maxLength={800} value={draft.goalKeywords} onChange={(event) => update('goalKeywords', event.target.value)} placeholder="日程候補が提示された、連絡先交換を提案された" /></label><label className="floating-field compact-number"><span>1日の目標人数</span><input type="number" min="1" max="100" value={draft.goalTarget} onChange={(event) => update('goalTarget', Number(event.target.value))} /></label></div></section>
  </div>;
}

type FormProps = { draft: Draft; update: <K extends keyof Draft>(key: K, value: Draft[K]) => void };

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: Array<readonly [string, string]>; onChange: (value: string) => void }) {
  return <fieldset className="segmented-setting"><legend>{label}</legend><div>{options.map(([option, text]) => <button key={option} type="button" className={value === option ? 'is-active' : ''} onClick={() => onChange(option)} aria-pressed={value === option}>{text}</button>)}</div></fieldset>;
}

function Toggle({ checked, onChange, title }: { checked: boolean; onChange: (value: boolean) => void; title: string }) {
  return <label className="switch-row"><span><strong>{title}</strong><small>必ず本人に確認してから進める</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function HubState({ title, text, busy, action }: { title: string; text?: string; busy?: boolean; action?: React.ReactNode }) {
  return <section className="hub-state">{busy && <span className="hub-spinner" />}<h1>{title}</h1>{text && <p>{text}</p>}{action}</section>;
}

function toDraft(rule: DashboardRule): Draft {
  return { ...rule, topics: rule.topics.join('、'), blockedTopics: rule.blockedTopics.join('、'), goalKeywords: rule.goalKeywords.join('、'), preferredLocations: rule.preferredLocations.join('、'), requiredProfileKeywords: rule.requiredProfileKeywords.join('、'), excludedProfileKeywords: rule.excludedProfileKeywords.join('、'), forbiddenPhrases: rule.forbiddenPhrases.join('、'), escalationTriggers: rule.escalationTriggers.join('、') };
}

function split(value: string) {
  return Array.from(new Set(value.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean)));
}

function appendItem(value: string, item: string) {
  const values = split(value);
  return values.includes(item) ? value : [...values, item].join('、');
}

function presetOptions(mode: Mode) {
  return mode === 'preferences'
    ? [
        { id: 'balanced', label: 'バランス重視', detail: '近すぎず狭すぎない条件', recommended: true },
        { id: 'nearby', label: '近場を優先', detail: '会いやすい距離を重視', recommended: false },
        { id: 'wide', label: '候補を広めに', detail: 'プロフィールで後から絞る', recommended: false },
      ]
    : [
        { id: 'safe-auto', label: '許可済み自動', detail: '許可済み接続の高確信度だけ送信', recommended: true },
        { id: 'friendly', label: '親しみ重視', detail: '短く柔らかい会話', recommended: false },
        { id: 'review', label: '確認を多めに', detail: 'Telegram確認後に送信', recommended: false },
      ];
}

function presetDraft(current: Draft, mode: Mode, preset: string): Draft {
  if (mode === 'preferences') {
    if (preset === 'nearby') return { ...current, radiusKm: 15, requiredProfileKeywords: '', excludedProfileKeywords: '勧誘、投資、既婚、業者', desiredRelationship: '近い地域で、まずは気軽に会える相手を探す' };
    if (preset === 'wide') return { ...current, radiusKm: 60, requiredProfileKeywords: '', excludedProfileKeywords: '勧誘、投資、既婚、業者', desiredRelationship: '共通点と会話の相性を重視して探す' };
    return { ...current, radiusKm: 30, requiredProfileKeywords: '', excludedProfileKeywords: '勧誘、投資、既婚、業者', desiredRelationship: '会話の相性を確かめてから、自然に会える相手を探す' };
  }

  const safety = {
    blockedTopics: '金銭、投資、宗教、政治、認証コード、個人情報',
    forbiddenPhrases: '絶対会おう、運命だね、すぐ連絡先を教えて、本人確認コードを教えて',
    escalationTriggers: '金銭の話、本人確認情報、強い勧誘、体調不良、日程や場所の確定、連絡先交換',
    requireApprovalForScheduling: true,
    requireApprovalForContactExchange: false,
    contactExchangeDirection: 'receive_only' as const,
    requiredConversationFields: ['marriage_intent', 'line_contact'] as Array<'marriage_intent' | 'line_contact'>,
    goalKeywords: '相手が婚活意思を明示した、相手からLINEを受領した',
    persona: current.persona || 'プロフィールと会話に出た事実だけを使う。知らないことは知ったふりをせず、約束や個人情報に関する判断は本人へ戻す。',
  } satisfies Partial<Draft>;

  if (preset === 'friendly') return { ...current, ...safety, automationMode: 'full_auto', minimumConfidence: 88, conversationTone: 'friendly', replyLength: 'short', questionFrequency: 'balanced' };
  if (preset === 'review') return { ...current, ...safety, automationMode: 'approval', minimumConfidence: 92, conversationTone: 'natural', replyLength: 'balanced', questionFrequency: 'low' };
  return { ...current, ...safety, automationMode: 'full_auto', minimumConfidence: 90, conversationTone: 'natural', replyLength: 'balanced', questionFrequency: 'balanced' };
}
