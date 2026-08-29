'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DashboardCandidate, DashboardPayload } from '@/lib/dashboard-types';
import { connectorDefinitions, serviceCatalogDefinitions } from '@/lib/automation/connectors';
import { ThemeToggle } from '@/app/theme-toggle';
import { useGuardedFetch } from '@/lib/use-guarded-fetch';
import { unicodeLength } from '@/lib/unicode-text';

type View = 'home' | 'inbox' | 'matches' | 'settings';
type Modal = 'stop' | 'notifications' | 'connect' | 'audit' | 'password' | 'deleteAccount' | null;
type AuthState = 'checking' | 'login' | 'register' | 'mfa' | 'recovery' | 'setup_required' | 'unavailable';

type BillingState = {
  enabled: boolean;
  configured: boolean;
  planName: string;
  canManage: boolean;
  subscription: {
    status: string;
    active: boolean;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
};

type Conversation = {
  id: string;
  contactId: string;
  initials: string;
  name: string;
  meta: string;
  message: string;
  reply: string;
  stage: string;
  confidence: number;
  reason: string;
  time: string;
  dateTime: string;
  unread: number;
  needsReview: boolean;
  color: string;
  status: 'active' | 'paused' | 'escalated' | 'goal_reached' | 'closed';
  messages: DashboardPayload['conversations'][number]['messages'];
  draftMessageId: string | null;
};

type Toast = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const connectableProviders = connectorDefinitions.filter((connector) => connector.supportStatus === 'assisted');

function Avatar({ initials, color, size = 'md' }: { initials: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'h-16 w-16 text-sm' : size === 'sm' ? 'h-10 w-10 text-[11px]' : 'h-12 w-12 text-xs';
  return <div aria-hidden="true" className={`grid shrink-0 place-items-center rounded-[18px] bg-gradient-to-br font-extrabold ${color} ${sizeClass}`}>{initials}</div>;
}

const avatarColors = [
  'from-sky-100 to-blue-50 text-sky-700',
  'from-violet-100 to-fuchsia-50 text-violet-700',
  'from-amber-100 to-orange-50 text-amber-700',
  'from-emerald-100 to-teal-50 text-emerald-700',
  'from-rose-100 to-pink-50 text-rose-700',
];

function toUiConversation(conversation: DashboardPayload['conversations'][number], index: number): Conversation {
  const incoming = [...conversation.messages].reverse().find((message) => message.direction === 'incoming');
  const draft = [...conversation.messages].reverse().find((message) => message.direction === 'outgoing' && ['draft', 'queued', 'failed'].includes(message.sendState));
  return {
    id: conversation.id,
    contactId: conversation.contactId,
    initials: conversation.initials,
    name: conversation.name,
    meta: [conversation.age ? `${conversation.age}歳` : null, conversation.providerLabel, conversation.location].filter(Boolean).join(' · '),
    message: (incoming?.body ?? conversation.summary) || 'まだメッセージはありません。',
    reply: draft?.body ?? '',
    stage: stageLabel(conversation.stage, conversation.status),
    confidence: conversation.confidence,
    reason: conversation.summary || '設定したテーマ・安全条件・過去の修正内容をもとに判断しています。',
    time: formatRelativeTime(conversation.lastMessageAt),
    dateTime: conversation.lastMessageAt ?? new Date(0).toISOString(),
    unread: incoming ? 1 : 0,
    needsReview: conversation.status === 'escalated' || draft?.sendState === 'failed',
    color: avatarColors[index % avatarColors.length],
    status: conversation.status,
    messages: conversation.messages,
    draftMessageId: draft?.id ?? null,
  };
}

function stageLabel(stage: string, status: Conversation['status']) {
  if (status === 'escalated') return 'あなたの判断が必要';
  if (status === 'paused') return '一時停止';
  if (status === 'goal_reached') return '条件を達成';
  const labels: Record<string, string> = {
    rapport: '関係を構築中',
    discovery: '共通点を探索中',
    scheduling: '日程を調整中',
  };
  return labels[stage] ?? stage;
}

function automationModeLabel(mode: DashboardPayload['rule']['automationMode']) {
  return mode === 'full_auto' ? '許可済み全自動' : mode === 'approval' ? '確認して送信' : '下書きのみ';
}

function workerStatusLabel(status: DashboardPayload['worker']['status']) {
  return status === 'online' ? '稼働中' : status === 'busy' ? '処理中' : status === 'degraded' ? '設定不足' : 'オフライン';
}

function formatRelativeTime(value: string | null) {
  if (!value) return '—';
  const difference = Date.now() - new Date(value).getTime();
  if (difference < 60_000) return 'たった今';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}分前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}時間前`;
  return `${Math.floor(difference / 86_400_000)}日前`;
}

function providerPresentation(provider: string) {
  const map: Record<string, { tone: string; label: string }> = {
    pairs: { tone: 'bg-sky-500', label: 'P' },
    with: { tone: 'bg-violet-500', label: 'W' },
    tinder: { tone: 'bg-rose-500', label: 'T' },
    omiai: { tone: 'bg-blue-600', label: 'O' },
    tapple: { tone: 'bg-orange-500', label: 'T' },
    marrish: { tone: 'bg-pink-500', label: 'M' },
    youbride: { tone: 'bg-indigo-500', label: 'Y' },
    dine: { tone: 'bg-slate-800', label: 'D' },
    bumble: { tone: 'bg-amber-400', label: 'B' },
  };
  return map[provider] ?? { tone: 'bg-slate-500', label: provider.slice(0, 1).toUpperCase() };
}

function auditStatusLabel(status: DashboardPayload['auditEvents'][number]['status']) {
  const labels: Record<DashboardPayload['auditEvents'][number]['status'], string> = {
    awaiting_approval: '承認待ち',
    pending: '待機中',
    leased: '実行中',
    completed: '完了',
    failed: '失敗',
    cancelled: '取消済み',
  };
  return labels[status];
}

function auditTypeLabel(type: string) {
  const labels: Record<string, string> = {
    start_session: '接続準備',
    like_contact: 'いいね',
    send_message: '返信送信',
    send_approved_reply: '承認済み返信',
    generate_reply: '返信案生成',
    pause_all: '全体停止',
    resume_all: '全体再開',
    pause_conversation: '会話停止',
    resume_conversation: '会話再開',
    sync_rules: 'ルール同期',
    data_export: 'データ書き出し',
    identity_profile_updated: '登録情報を更新',
    gmail_verification_code_checked: 'Gmail認証コードを確認',
    operations_self_test: '総合セルフテスト',
  };
  return labels[type] ?? type.replaceAll('_', ' ');
}

function billingStatusLabel(status: string) {
  const labels: Record<string, string> = {
    active: '利用中',
    trialing: '無料期間中',
    past_due: '支払い確認が必要',
    unpaid: '未払い',
    paused: '一時停止',
    canceled: '解約済み',
    incomplete: '手続き未完了',
    incomplete_expired: '手続き期限切れ',
  };
  return labels[status] ?? '確認中';
}

const readinessPriority: Record<DashboardPayload['readiness']['checks'][number]['id'], number> = {
  identity: 0,
  gmail: 1,
  ai: 2,
  service: 3,
  worker: 4,
  telegram: 5,
  line_report: 6,
  rules: 7,
  operation: 8,
  security: 9,
  backup: 10,
  self_test: 11,
};

const readinessStatusPriority: Record<DashboardPayload['readiness']['checks'][number]['status'], number> = {
  action: 0,
  blocked: 1,
  ready: 2,
};

const readinessActionLabel: Record<DashboardPayload['readiness']['checks'][number]['id'], string> = {
  worker: '状態と起動方法を確認',
  identity: '共通情報を登録',
  service: '使うアプリを接続',
  ai: 'AI返信の設定を確認',
  gmail: 'Gmail連携を設定',
  telegram: 'Telegramを接続',
  line_report: 'LINE報告条件を確認',
  rules: 'AI会話ルールを設定',
  operation: '運転スイッチを確認',
  security: '2段階認証を設定',
  backup: 'バックアップを作成',
  self_test: '総合テストを実行',
};

const autopilotStageCopy: Record<DashboardPayload['verification']['stages'][number]['id'], { label: string; detail: string }> = {
  connected: { label: 'ログイン・登録', detail: '実サービスを接続' },
  candidate: { label: '候補取得', detail: '条件に合う相手を抽出' },
  liked: { label: 'いいね', detail: '許可済みサービスで送信' },
  matched: { label: 'マッチ', detail: '相互マッチを検知' },
  reply_sent: { label: 'AI会話', detail: 'ルール内で返信' },
  line_reported: { label: 'Telegram報告', detail: 'LINE受領を定型報告' },
};

function formatBillingDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value));
}

export default function Home() {
  const fetchWithTimeout = useGuardedFetch();
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [setupToken, setSetupToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('setup') ?? '';
  });
  const [inviteToken, setInviteToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('invite') ?? '';
  });
  const [signupRequested] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('signup') === '1';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallengeId, setMfaChallengeId] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [recoveryChallengeId, setRecoveryChallengeId] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryStage, setRecoveryStage] = useState<'request' | 'verify'>('request');
  const [authNotice, setAuthNotice] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('deleted') === '1'
      ? 'アカウントと保存データを削除しました。'
      : '';
  });
  const [activeView, setActiveView] = useState<View>(() => {
    if (typeof window === 'undefined') return 'home';
    const requestedView = new URLSearchParams(window.location.search).get('view');
    return requestedView === 'matches' || requestedView === 'settings' ? requestedView : 'home';
  });
  const [isActive, setIsActive] = useState(false);
  const [isSavingState, setIsSavingState] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [likedCandidates, setLikedCandidates] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [minimumConfidence, setMinimumConfidence] = useState(85);
  const [autoMode, setAutoMode] = useState<'full_auto' | 'approval' | 'draft_only'>('approval');
  const [minAge, setMinAge] = useState(30);
  const [maxAge, setMaxAge] = useState(70);
  const [radiusKm, setRadiusKm] = useState(30);
  const [selectedProviders, setSelectedProviders] = useState<string[]>(['pairs']);
  const [connectionIntent, setConnectionIntent] = useState<'existing' | 'new'>('existing');
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [billingAction, setBillingAction] = useState<'checkout' | 'portal' | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const modalFocusRef = useRef<HTMLButtonElement>(null);

  const conversations = useMemo(() => dashboard?.conversations.map(toUiConversation) ?? [], [dashboard]);
  const candidates = dashboard?.candidates ?? [];
  const apps = dashboard?.connections.map((connection) => ({
    id: connection.id,
    provider: connection.provider,
    name: connection.label,
    state: connection.status === 'connected' ? '同期済み' : connection.status === 'needs_verification' ? '本人確認待ち' : connection.status === 'expired' ? '再ログイン' : connection.status === 'error' ? 'エラー' : '一時停止',
    detail: connection.lastHeartbeatAt ? formatRelativeTime(connection.lastHeartbeatAt) : '未同期',
    ...providerPresentation(connection.provider),
  })) ?? [];
  const showAppChrome = Boolean(dashboard) && !requiresLogin;
  const nextReadinessCheck = useMemo(() => {
    if (!dashboard) return null;
    const incomplete = dashboard.readiness.checks.filter((check) => check.status !== 'ready');
    return incomplete.toSorted((left, right) => {
      if (readinessStatusPriority[left.status] !== readinessStatusPriority[right.status]) return readinessStatusPriority[left.status] - readinessStatusPriority[right.status];
      return readinessPriority[left.id] - readinessPriority[right.id];
    })[0] ?? null;
  }, [dashboard]);
  const autopilotStages = useMemo(() => {
    const stages = dashboard?.verification.stages ?? [];
    const nextStageIndex = stages.findIndex((stage) => !stage.verified);
    return stages.map((stage, index) => ({
      ...stage,
      ...autopilotStageCopy[stage.id],
      state: stage.verified ? 'verified' : index === nextStageIndex ? 'current' : 'waiting',
    }));
  }, [dashboard]);

  const openReadinessDestination = useCallback((href: string) => {
    if (!href.includes('view=settings')) return;
    setActiveView('settings');
    const targetId = href.split('#')[1];
    if (targetId) {
      window.setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    }
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setCurrentPassword('');
    setNewPassword('');
    setNewPasswordConfirmation('');
    setPasswordChangeError(null);
    setIsChangingPassword(false);
    setDeletePassword('');
    setDeleteConfirmation('');
    setDeleteError(null);
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetchWithTimeout('/api/dashboard', { headers: { accept: 'application/json' }, cache: 'no-store' });
      setLoadError(null);
      const result = (await response.json()) as DashboardPayload | { error?: string };
      if (response.status === 401) {
        setAuthState('checking');
        setRequiresLogin(true);
        setDashboard(null);
        return;
      }
      if (!response.ok || !('user' in result)) throw new Error('dashboard_load_failed');
      setRequiresLogin(false);
      setDashboard(result);
      setIsActive(result.user.automationState === 'active');
      setLikedCandidates(result.candidates.filter((candidate) => candidate.status === 'liked').map((candidate) => candidate.id));
      setMinimumConfidence(result.rule.minimumConfidence);
      setAutoMode(result.rule.automationMode);
      setMinAge(result.rule.minAge ?? 30);
      setMaxAge(result.rule.maxAge ?? 70);
      setRadiusKm(result.rule.radiusKm ?? 30);
      const url = new URL(window.location.href);
      if (url.searchParams.get('delete') === '1') {
        url.searchParams.delete('delete');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        setActiveView('settings');
        setModal('deleteAccount');
      }
    } catch {
      setLoadError('データを読み込めませんでした。接続を確認して再試行してください。');
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithTimeout]);

  const loadBilling = useCallback(async () => {
    setIsBillingLoading(true);
    try {
      const response = await fetchWithTimeout('/api/billing/status', { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('billing_status_failed');
      setBilling((await response.json()) as BillingState);
    } catch {
      setBilling(null);
    } finally {
      setIsBillingLoading(false);
    }
  }, [fetchWithTimeout]);

  useEffect(() => {
    void Promise.resolve().then(() => loadDashboard());
  }, [loadDashboard]);

  const billingUserId = dashboard?.user.id;
  useEffect(() => {
    if (!billingUserId) return;
    void Promise.resolve().then(() => loadBilling());
  }, [billingUserId, loadBilling]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const billingResult = url.searchParams.get('billing');
    if (!billingResult) return;
    url.searchParams.delete('billing');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    void Promise.resolve().then(() => setToast({
      message: billingResult === 'success'
        ? 'Stripeでの申込みを受け付けました。契約状態を同期しています'
        : billingResult === 'cancelled'
          ? '申込みをキャンセルしました。請求は発生していません'
          : '請求設定を更新しました',
    }));
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('deleted') !== '1') return;
    url.searchParams.delete('deleted');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    if (!setupToken && !inviteToken) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, [inviteToken, setupToken]);

  useEffect(() => {
    if (!setupToken) return;
    let active = true;
    void fetchWithTimeout('/api/auth/setup-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupToken }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('setup_session_failed');
        if (active) setSetupToken('');
      })
      .catch(() => {
        if (!active) return;
        setSignInError('初回設定リンクが無効です。管理者へ新しいリンクを依頼してください。');
        setSetupToken('');
      });
    return () => {
      active = false;
    };
  }, [fetchWithTimeout, setupToken]);

  useEffect(() => {
    if (!requiresLogin || setupToken) return;
    let active = true;
    void fetchWithTimeout('/api/auth/status', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('auth_status_failed');
        const result = (await response.json()) as { authConfigured?: boolean; registrationOpen?: boolean; setupAuthorized?: boolean };
        if (!active) return;
        if (!result.authConfigured) setAuthState('unavailable');
        else if (inviteToken) setAuthState('register');
        else if (result.registrationOpen) setAuthState(result.setupAuthorized ? 'register' : 'setup_required');
        else {
          setAuthState('login');
          if (signupRequested) setAuthNotice('新規登録は招待制です。管理者から届いた招待リンクを開いてください。');
        }
      })
      .catch(() => {
        if (active) setAuthState('unavailable');
      });
    return () => {
      active = false;
    };
  }, [fetchWithTimeout, inviteToken, requiresLogin, setupToken, signupRequested]);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  useEffect(() => {
    const syncViewFromUrl = () => {
      const requestedView = new URLSearchParams(window.location.search).get('view');
      const nextView: View = requestedView === 'matches' || requestedView === 'settings' ? requestedView : 'home';
      setActiveView(nextView);
      if (nextView === 'home') window.scrollTo({ top: 0 });
      const targetId = window.location.hash.replace(/^#/, '');
      if (targetId) window.setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ block: 'start' }), 80);
    };
    window.addEventListener('popstate', syncViewFromUrl);
    return () => window.removeEventListener('popstate', syncViewFromUrl);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const updateStandalone = () => setIsStandalone(media.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    updateStandalone();
    media.addEventListener('change', updateStandalone);
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    return () => {
      media.removeEventListener('change', updateStandalone);
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!modal) return;
    modalFocusRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleDialogKeys);
    };
  }, [closeModal, modal]);

  const showModal = (nextModal: Exclude<Modal, null>) => {
    setModal(nextModal);
  };

  const finishAuthentication = async () => {
    setPassword('');
    setShowPassword(false);
    setSetupToken('');
    setInviteToken('');
    setMfaChallengeId('');
    setAuthCode('');
    setRecoveryChallengeId('');
    setRecoveryCode('');
    setRecoveryPassword('');
    setRecoveryStage('request');
    setRequiresLogin(false);
    setIsLoading(true);
    await loadDashboard();
  };

  const signIn = async () => {
    if (!email.trim() || !password || isSigningIn) return;
    setIsSigningIn(true);
    setSignInError(null);
    try {
      const response = await fetchWithTimeout('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as { error?: string; mfaRequired?: boolean; challengeId?: string };
      if (response.status === 202 && result.mfaRequired && result.challengeId) {
        setMfaChallengeId(result.challengeId);
        setAuthCode('');
        setPassword('');
        setAuthState('mfa');
        return;
      }
      if (!response.ok) {
        setSignInError(result.error === 'too_many_attempts'
          ? '試行回数が多すぎます。15分後に再試行してください。'
          : result.error === 'account_suspended'
            ? 'このアカウントは管理者により停止されています。'
          : result.error === 'auth_not_configured'
            ? '認証の設定が完了していません。'
            : result.error === 'mfa_delivery_failed'
              ? 'Telegramへ確認コードを送れませんでした。接続を確認してください。'
            : 'メールアドレスまたはパスワードが違います。');
        return;
      }
      await finishAuthentication();
    } catch {
      setSignInError('接続を確認して再試行してください。');
    } finally {
      setIsSigningIn(false);
    }
  };

  const verifyMfa = async () => {
    if (!mfaChallengeId || !/^\d{6}$/.test(authCode) || isSigningIn) return;
    setIsSigningIn(true); setSignInError(null);
    try {
      const response = await fetchWithTimeout('/api/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: mfaChallengeId, code: authCode }) });
      if (!response.ok) { setSignInError('確認コードが違うか、有効期限が切れています。'); return; }
      await finishAuthentication();
    } catch {
      setSignInError('接続を確認して再試行してください。');
    } finally { setIsSigningIn(false); }
  };

  const requestRecovery = async () => {
    if (!email.trim() || isSigningIn) return;
    setIsSigningIn(true); setSignInError(null);
    try {
      const response = await fetchWithTimeout('/api/auth/recovery/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      const result = await response.json() as { challengeId?: string; error?: string };
      if (!response.ok || !result.challengeId) throw new Error(result.error ?? 'request_failed');
      setRecoveryChallengeId(result.challengeId); setRecoveryStage('verify');
    } catch {
      setSignInError('メールアドレスを確認して再試行してください。');
    } finally { setIsSigningIn(false); }
  };

  const confirmRecovery = async () => {
    if (!recoveryChallengeId || !/^\d{6}$/.test(recoveryCode) || unicodeLength(recoveryPassword) < 8 || isSigningIn) return;
    setIsSigningIn(true); setSignInError(null);
    try {
      const response = await fetchWithTimeout('/api/auth/recovery/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: recoveryChallengeId, code: recoveryCode, newPassword: recoveryPassword }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setSignInError(result.error === 'invalid_new_password' ? 'パスワードは8〜128文字で入力してください。' : '確認コードが違うか、有効期限が切れています。');
        return;
      }
      await finishAuthentication();
    } catch {
      setSignInError('接続を確認して再試行してください。');
    } finally { setIsSigningIn(false); }
  };

  const createAccount = async () => {
    if (!email.trim() || !password || isSigningIn) return;
    if (unicodeLength(password) < 8) {
      setSignInError('パスワードは8文字以上で入力してください。');
      return;
    }
    setIsSigningIn(true);
    setSignInError(null);
    try {
      const response = await fetchWithTimeout('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, setupToken, inviteToken }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        setSignInError(result.error === 'invalid_email'
          ? '有効なメールアドレスを入力してください。'
          : result.error === 'invalid_password'
            ? 'パスワードは8〜128文字で入力してください。'
            : result.error === 'registration_closed'
              ? '初回設定は完了済みです。ログイン画面を再読み込みしてください。'
              : result.error === 'invalid_setup_token'
                ? '初回設定リンクが無効です。'
                : result.error === 'admin_email_required'
                  ? '指定された管理者メールアドレスで登録してください。'
                  : result.error === 'invite_required'
                    ? '新規登録には管理者が発行した招待リンクが必要です。'
                  : result.error === 'invalid_invite'
                    ? '招待リンクが無効か、期限切れです。'
                    : result.error === 'invite_email_mismatch'
                      ? '招待されたメールアドレスと一致しません。'
                      : result.error === 'email_in_use'
                      ? 'このメールアドレスは登録済みです。'
                      : result.error === 'too_many_attempts'
                        ? '作成回数が多すぎます。15分後に再試行してください。'
                : 'アカウントを作成できませんでした。');
        return;
      }
      await finishAuthentication();
    } catch {
      setSignInError('接続を確認して再試行してください。');
    } finally {
      setIsSigningIn(false);
    }
  };

  const signOut = async () => {
    await fetchWithTimeout('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setDashboard(null);
    setRequiresLogin(true);
    setActiveView('home');
    setToast(null);
  };

  const installApp = async () => {
    if (isStandalone) {
      setToast({ message: 'MatchPilotはすでにアプリとして起動しています' });
      return;
    }
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      setToast({ message: choice.outcome === 'accepted' ? 'ホーム画面へ追加しました' : '追加をキャンセルしました' });
      return;
    }
    const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    setToast({
      message: isAppleMobile
        ? 'Safariの共有ボタンから「ホーム画面に追加」を選んでください'
        : 'ブラウザのメニューから「アプリをインストール」を選んでください',
    });
  };

  const deleteAccount = async () => {
    if (isDeletingAccount || unicodeLength(deletePassword) < 8 || deleteConfirmation !== '削除') return;
    setIsDeletingAccount(true);
    setDeleteError(null);
    try {
      const response = await fetchWithTimeout('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: deletePassword, confirmation: deleteConfirmation }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        const message = result.error === 'invalid_password'
          ? 'パスワードが違います。'
          : result.error === 'subscription_cancellation_failed'
            ? '契約を停止できませんでした。支払い管理から解約後に再試行してください。'
            : 'アカウントを削除できませんでした。しばらくして再試行してください。';
        throw new Error(message);
      }
      setDashboard(null);
      setRequiresLogin(true);
      setAuthState('checking');
      setAuthNotice('アカウントと保存データを削除しました。');
      setPassword('');
      setDeletePassword('');
      setDeleteConfirmation('');
      setModal(null);
      router.replace('/');
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'アカウントを削除できませんでした。');
      setIsDeletingAccount(false);
    }
  };

  const changePassword = async () => {
    if (isChangingPassword || unicodeLength(currentPassword) < 8 || unicodeLength(newPassword) < 8 || newPassword !== newPasswordConfirmation) return;
    setIsChangingPassword(true);
    setPasswordChangeError(null);
    try {
      const response = await fetchWithTimeout('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        const message = result.error === 'invalid_current_password'
          ? '現在のパスワードが違います。'
          : result.error === 'password_reused'
            ? '現在とは異なるパスワードを設定してください。'
            : result.error === 'invalid_new_password'
              ? '新しいパスワードは8〜128文字で入力してください。'
              : 'パスワードを変更できませんでした。しばらくして再試行してください。';
        throw new Error(message);
      }
      closeModal();
      setToast({ message: 'パスワードを変更し、ほかの端末からログアウトしました' });
    } catch (error) {
      setPasswordChangeError(error instanceof Error ? error.message : 'パスワードを変更できませんでした。');
      setIsChangingPassword(false);
    }
  };

  const openStripeFlow = async (kind: 'checkout' | 'portal') => {
    if (billingAction) return;
    setBillingAction(kind);
    try {
      const response = await fetchWithTimeout(`/api/billing/${kind}`, { method: 'POST' });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        if (result.error === 'subscription_exists') await loadBilling();
        throw new Error(result.error ?? 'billing_request_failed');
      }
      const url = new URL(result.url);
      const allowedHost = kind === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com';
      if (url.protocol !== 'https:' || url.hostname !== allowedHost) throw new Error('unsafe_billing_redirect');
      window.location.assign(url.toString());
    } catch (error) {
      setToast({
        message: error instanceof Error && error.message === 'billing_not_enabled'
          ? '料金設定が完了するまで申込みは開始されません'
          : 'Stripeの画面を開けませんでした。しばらくして再試行してください',
      });
      setBillingAction(null);
    }
  };

  const persistAutomationState = async (nextActive: boolean) => {
    const previous = isActive;
    setIsActive(nextActive);
    setIsSavingState(true);
    try {
      const response = await fetchWithTimeout('/api/control/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: nextActive ? 'active' : 'paused' }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'authentication_required' : 'request_failed');
      void loadDashboard();
      setToast({
        message: nextActive ? 'すべての自動操作を再開しました' : 'すべての自動操作を停止しました',
        actionLabel: '元に戻す',
        onAction: () => void persistAutomationState(previous),
      });
    } catch (error) {
      setIsActive(previous);
      setToast({
        message: error instanceof Error && error.message === 'authentication_required'
          ? '状態を保存するにはログインが必要です'
          : '保存できませんでした。接続を確認してください',
      });
    } finally {
      setIsSavingState(false);
    }
  };

  const confirmStop = () => {
    closeModal();
    void persistAutomationState(false);
  };

  const likeCandidate = async (candidate: DashboardCandidate) => {
    if (likedCandidates.includes(candidate.id)) return;
    setLikedCandidates((current) => [...current, candidate.id]);
    try {
      const response = await postAction({ action: 'candidate.like', contactId: candidate.id });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? 'request_failed');
      }
      setToast({ message: `${candidate.name}さんへのいいねを予約しました` });
      void loadDashboard();
    } catch (error) {
      setLikedCandidates((current) => current.filter((id) => id !== candidate.id));
      setToast({ message: error instanceof Error && error.message === 'daily_new_contact_limit_reached' ? 'このアプリは本日の新規5人に達しました' : 'いいねを予約できませんでした' });
    }
  };

  const archiveCandidate = async (candidate: DashboardCandidate) => {
    const response = await postAction({ action: 'candidate.archive', contactId: candidate.id });
    setToast({ message: response.ok ? `${candidate.name}さんを候補から外しました` : '候補を更新できませんでした' });
    if (response.ok) void loadDashboard();
  };

  const connectProvider = async (provider: string) => {
    const response = await postAction({ action: 'connection.add', provider, connectionIntent: 'existing' });
    closeModal();
    setToast({ message: response.ok ? '接続準備を開始しました。認証が必要な画面だけお知らせします' : '接続を開始できませんでした' });
    if (response.ok) void loadDashboard();
  };

  const connectSelectedProviders = async () => {
    if (selectedProviders.length === 0) {
      setToast({ message: '接続するサービスを1件以上選んでください' });
      return;
    }
    const response = await postAction({
      action: 'connection.addMany',
      providers: selectedProviders,
      connectionIntent,
    });
    closeModal();
    setToast({
      message: response.ok
        ? `${selectedProviders.length}サービスの${connectionIntent === 'new' ? '新規登録' : 'ログイン'}準備をまとめて開始しました`
        : '一括セットアップを開始できませんでした',
    });
    if (response.ok) void loadDashboard();
  };

  const toggleSelectedProvider = (provider: string) => {
    setSelectedProviders((current) => current.includes(provider)
      ? current.filter((item) => item !== provider)
      : [...current, provider].slice(0, 5));
  };

  const unlinkTelegram = async () => {
    const response = await postAction({ action: 'telegram.unlink' });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setToast({ message: response.ok ? 'Telegramの接続を解除しました' : result.error === 'disable_mfa_first' ? '先にセキュリティ画面で2段階認証を無効にしてください' : 'Telegramの接続を解除できませんでした' });
    if (response.ok) void loadDashboard();
  };

  const copyWorkerUserId = async () => {
    if (!dashboard?.user.id) return;
    try {
      await navigator.clipboard.writeText(dashboard.user.id);
      setToast({ message: 'ワーカー用ユーザーIDをコピーしました' });
    } catch {
      setToast({ message: `ワーカー用ユーザーID: ${dashboard.user.id}` });
    }
  };

  const exportPersonalData = async () => {
    try {
      const response = await fetchWithTimeout('/api/data/export', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('export_failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `matchpilot-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setToast({ message: '個人データを書き出しました' });
      void loadDashboard();
    } catch {
      setToast({ message: 'データを書き出せませんでした' });
    }
  };

  const connectTelegram = async () => {
    try {
      const response = await fetchWithTimeout('/api/integrations/telegram/link', { method: 'POST' });
      const result = (await response.json()) as { link?: string; error?: string };
      if (!response.ok || !result.link) throw new Error(result.error ?? 'request_failed');
      window.open(result.link, '_blank', 'noopener,noreferrer');
      setToast({ message: 'Telegramで「開始」を押すと接続が完了します' });
    } catch {
      setToast({ message: 'Telegram Botの設定を確認してください' });
    }
  };

  const switchView = (view: View) => {
    setActiveView(view);
    const nextUrl = view === 'home' ? '/' : `/?view=${view}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.pushState(null, '', nextUrl);
    }
    document.getElementById('main-content')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function postAction(payload: Record<string, unknown>) {
    return fetchWithTimeout('/api/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  const renderAuthentication = () => {
    if (authState === 'checking') return <AppState variant="auth" title="認証を確認しています" description="安全なログイン方法を準備しています。" busy />;
    if (authState === 'unavailable') return <AppState variant="auth" title="認証を準備できません" description="設定を確認してから、もう一度読み込んでください。" action={<button type="button" onClick={() => window.location.reload()} className="primary-button">再読み込み</button>} />;
    if (authState === 'setup_required') return <AppState variant="auth" title="初回設定が必要です" description="本人専用の初回設定リンクを一度開くと、このブラウザのどのタブでも登録を続けられます。" action={<div className="access-actions"><button type="button" onClick={() => window.location.reload()} className="primary-button">設定状態を再確認</button><Link href="/services" className="secondary-button">サービス一覧を見る</Link></div>} />;
    if (authState === 'mfa') return <AppState variant="auth" title="Telegramを確認" description="Botへ送った6桁の確認コードを入力してください。コードは10分間有効です。" action={<form className="access-form" onSubmit={(event) => { event.preventDefault(); void verifyMfa(); }}><label><span>確認コード</span><input type="text" inputMode="numeric" autoComplete="one-time-code" value={authCode} onChange={(event) => setAuthCode(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} placeholder="000000" pattern="[0-9]{6}" required /></label>{signInError && <p role="alert">{signInError}</p>}<button type="submit" disabled={isSigningIn || authCode.length !== 6} className="primary-button">{isSigningIn ? '確認中…' : '安全にログイン'}</button><button type="button" className="text-button" onClick={() => { setAuthState('login'); setMfaChallengeId(''); setAuthCode(''); setSignInError(null); }}>ログインへ戻る</button></form>} />;
    if (authState === 'recovery') return <AppState variant="auth" title="パスワードを再設定" description={recoveryStage === 'request' ? '登録メールを入力すると、接続済みTelegramへ確認コードを送ります。' : 'Telegramへ送った6桁コードと新しいパスワードを入力してください。'} action={recoveryStage === 'request' ? <form className="access-form" onSubmit={(event) => { event.preventDefault(); void requestRecovery(); }}><label><span>登録メールアドレス</span><input type="email" inputMode="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>{signInError && <p role="alert">{signInError}</p>}<button type="submit" disabled={isSigningIn || !email.trim()} className="primary-button">{isSigningIn ? '送信中…' : 'Telegramへコードを送る'}</button><button type="button" className="text-button" onClick={() => { setAuthState('login'); setSignInError(null); }}>ログインへ戻る</button></form> : <form className="access-form" onSubmit={(event) => { event.preventDefault(); void confirmRecovery(); }}><label><span>確認コード</span><input type="text" inputMode="numeric" autoComplete="one-time-code" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} placeholder="000000" pattern="[0-9]{6}" required /></label><label><span>新しいパスワード</span><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} placeholder="8文字以上" required /></label>{signInError && <p role="alert">{signInError}</p>}<button type="submit" disabled={isSigningIn || recoveryCode.length !== 6 || unicodeLength(recoveryPassword) < 8} className="primary-button">{isSigningIn ? '更新中…' : 'パスワードを更新'}</button><button type="button" className="text-button" onClick={() => { setRecoveryStage('request'); setRecoveryCode(''); setRecoveryPassword(''); setSignInError(null); }}>コードを送り直す</button></form>} />;
    if (authState === 'register') {
      return <AppState variant="auth" title={inviteToken ? '招待アカウントを作成' : 'アカウントを作成'} description={inviteToken ? '招待されたメールアドレスと、安全なパスワードを登録してください。' : 'メールとパスワードだけで始められます。作成後はどの端末からでもログインできます。'} action={
        <form className="access-form" onSubmit={(event) => { event.preventDefault(); void createAccount(); }}>
          {authNotice && <p className="auth-notice" role="status">{authNotice}</p>}
          <label><span>メールアドレス</span><input type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" maxLength={254} required /></label>
          <div className="password-input-group"><label htmlFor="auth-password"><span>パスワード</span></label><span className="password-field"><input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8文字以上" minLength={8} maxLength={128} required /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}>{showPassword ? '隠す' : '表示'}</button></span></div>
          <small className="auth-help">8〜128文字。英字・数字・記号を組み合わせると安全です。</small>
          {signInError && <p role="alert">{signInError}</p>}
          <button type="submit" disabled={isSigningIn || !email.trim() || unicodeLength(password) < 8} className="primary-button">{isSigningIn ? '作成中…' : 'アカウントを作成'}</button>
          <p className="auth-legal">作成すると<Link href="/terms">利用規約</Link>と<Link href="/privacy">プライバシーポリシー</Link>に同意したものとみなされます。</p>
          {!inviteToken && <button type="button" className="text-button" onClick={() => { setAuthState('login'); setSignInError(null); window.history.replaceState(null, '', '/'); }}>登録済みの方はログイン</button>}
          <Link href="/services" className="text-button">対応サービスを見る <span>{serviceCatalogDefinitions.length}件</span></Link>
        </form>
      } />;
    }
    return <AppState variant="auth" title="おかえりなさい" description="登録したメールアドレスとパスワードでログインします。" action={
      <form className="access-form" onSubmit={(event) => { event.preventDefault(); void signIn(); }}>
        {authNotice && <p className="auth-notice" role="status">{authNotice}</p>}
        <label><span>メールアドレス</span><input type="email" inputMode="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" maxLength={254} required /></label>
        <div className="password-input-group"><label htmlFor="auth-password"><span>パスワード</span></label><span className="password-field"><input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8文字以上" minLength={8} maxLength={128} required /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}>{showPassword ? '隠す' : '表示'}</button></span></div>
        {signInError && <p role="alert">{signInError}</p>}
        <button type="submit" disabled={isSigningIn || !email.trim() || unicodeLength(password) < 8} className="primary-button">{isSigningIn ? '確認中…' : 'ログイン'}</button>
        <button type="button" className="text-button" onClick={() => { setAuthState('recovery'); setRecoveryStage('request'); setSignInError(null); }}>パスワードを忘れた場合</button>
        <a href="/signup" className="secondary-button">招待リンクでアカウント作成</a>
        <p className="auth-legal"><Link href="/privacy">プライバシー</Link><span aria-hidden="true"> · </span><Link href="/terms">利用規約</Link><span aria-hidden="true"> · </span><Link href="/support">ヘルプ</Link></p>
        <Link href="/services" className="text-button">対応サービスを見る <span>{serviceCatalogDefinitions.length}件</span></Link>
      </form>
    } />;
  };

  const renderHome = () => (
    <div className="page-stack">
      <section className="hero-panel overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`status-pill ${isActive && dashboard?.readiness.level === 'ready' ? 'status-live' : 'status-paused'}`}><span className="status-dot" aria-hidden="true" />{isActive ? dashboard?.readiness.level === 'ready' ? '許可済み運転中' : '準備モード・外部操作停止' : 'すべて停止中'}</span>
            <span className="status-pill bg-white/10 text-white/80">{dashboard ? `${workerStatusLabel(dashboard.worker.status)} · ${formatRelativeTime(dashboard.worker.lastSeenAt)}` : 'ワーカー未接続'}</span>
          </div>
          <p className="hero-today-label">NEXT ACTION</p>
          <h1 className="max-w-xl text-[1.9rem] font-extrabold leading-[1.12] tracking-[-0.045em] text-white sm:text-[2.55rem]">{dashboard?.metrics.needsReview ? `${dashboard.metrics.needsReview}件だけ確認` : nextReadinessCheck ? readinessActionLabel[nextReadinessCheck.id] : 'あとは自動運転におまかせ'}</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-300">{dashboard?.metrics.needsReview ? '会話本文・返信案・スクリーンショットをTelegramにまとめました。' : nextReadinessCheck ? `${nextReadinessCheck.detail}。完了すると次の設定へ進みます。` : '判断が必要になった時だけTelegramへ報告します。'}</p>
          <div className="hero-action-row mt-5">
            {dashboard?.metrics.needsReview ? <a href="https://t.me/MatchPilotPersonalJPBot" target="_blank" rel="noreferrer" className="primary-light-button">Telegramで確認 <span aria-hidden="true">↗</span></a> : nextReadinessCheck ? <Link href={nextReadinessCheck.href} onClick={() => openReadinessDestination(nextReadinessCheck.href)} className="primary-light-button">{readinessActionLabel[nextReadinessCheck.id]} <span aria-hidden="true">›</span></Link> : <a href="https://t.me/MatchPilotPersonalJPBot" target="_blank" rel="noreferrer" className="primary-light-button">Telegramを開く <span aria-hidden="true">↗</span></a>}
          </div>
        </div>
        <div className="hero-orb hero-orb-one" aria-hidden="true" />
        <div className="hero-orb hero-orb-two" aria-hidden="true" />
      </section>

      <section className="autopilot-flow" aria-labelledby="autopilot-flow-title">
        <header>
          <div><p className="eyebrow">AUTO PILOT</p><h2 id="autopilot-flow-title">全自動の6ステップ</h2><p>実サービスで完了した工程だけを緑で表示します。</p></div>
          <strong>{dashboard?.verification.completedCount ?? 0}<small> / {dashboard?.verification.totalCount ?? 6}</small></strong>
        </header>
        <ol>
          {autopilotStages.map((stage, index) => <li key={stage.id} className={`is-${stage.state}`} aria-current={stage.state === 'current' ? 'step' : undefined}>
            <span aria-hidden="true">{stage.verified ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <div><small>STEP {String(index + 1).padStart(2, '0')}</small><strong>{stage.label}</strong><p>{stage.detail}</p></div>
            <em>{stage.verified ? '完了' : stage.state === 'current' ? '次に確認' : '待機'}</em>
          </li>)}
        </ol>
        <footer>
          <p>{dashboard?.verification.completedCount === dashboard?.verification.totalCount ? '登録・いいね・マッチ・AI会話・LINE報告まで実サービスで完走済みです。' : `実サービス検証は ${dashboard?.verification.completedCount ?? 0}/${dashboard?.verification.totalCount ?? 6}。設定が揃うまでは外部送信しません。`}</p>
          {nextReadinessCheck && <Link href={nextReadinessCheck.href} onClick={() => openReadinessDestination(nextReadinessCheck.href)}>次の設定へ <span aria-hidden="true">›</span></Link>}
        </footer>
      </section>

      <section className="overview-strip" aria-label="現在の進捗">
        {[
          ['判断待ち', dashboard?.metrics.needsReview ?? 0],
          ['会話中', dashboard?.metrics.activeConversations ?? 0],
          ['マッチ', dashboard?.metrics.matched ?? 0],
          ['条件達成', dashboard?.metrics.goalReached ?? 0],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </section>

      <section className={`readiness-audit ${dashboard?.readiness.level === 'ready' ? 'is-ready' : ''}`} aria-labelledby="readiness-title">
        <header><div><p className="eyebrow">LIVE READINESS</p><h2 id="readiness-title">運転準備診断</h2><p>設定済み・許可状態・実サービスでの完走実績を分けて表示します。</p></div><div className="readiness-score"><strong>{dashboard?.readiness.readyCount ?? 0}<small>/{dashboard?.readiness.totalCount ?? 8}</small></strong><span>準備済み項目</span></div></header>
        <details className="readiness-details">
          <summary><span>{dashboard?.readiness.totalCount ?? 9}項目の診断結果を見る</span><small>{Math.max(0, (dashboard?.readiness.totalCount ?? 9) - (dashboard?.readiness.readyCount ?? 0))}件の設定が残っています</small><i aria-hidden="true">⌄</i></summary>
          <div className="readiness-checks">
            {dashboard?.readiness.checks.map((check) => <Link key={check.id} href={check.href} onClick={() => openReadinessDestination(check.href)} className={`is-${check.status}`}><i aria-hidden="true">{check.status === 'ready' ? '✓' : check.status === 'blocked' ? '!' : '→'}</i><span><strong>{check.label}</strong><small>{check.detail}</small></span></Link>)}
          </div>
          <footer><p>{dashboard?.verification.completedCount === dashboard?.verification.totalCount ? 'アカウント接続からTelegram報告まで実サービスで完走済みです。' : '現在は実サービスでの全工程完走前です。「テスト完璧」とは表示しません。'}</p><Link href="/sources">設計ソースと比較調査を見る <span aria-hidden="true">›</span></Link></footer>
        </details>
      </section>

      <details className="home-tools">
        <summary><span><strong>設定とサービス</strong><small>必要な時だけ開く</small></span><i aria-hidden="true">⌄</i></summary>
        <section className="hub-shortcuts" aria-label="主要設定">
          <Link href="/compare"><span aria-hidden="true">◇</span><div><strong>自分向けサービス比較</strong><small>目的・年代・手間から3件に絞る</small></div><i aria-hidden="true">›</i></Link>
          <Link href="/services"><span aria-hidden="true">▦</span><div><strong>対応アプリ一覧</strong><small>ログイン・登録準備・接続状態</small></div><i aria-hidden="true">›</i></Link>
          <Link href="/accounts/new"><span aria-hidden="true">＋</span><div><strong>一括登録準備</strong><small>Web登録画面{connectableProviders.length}件をまとめて準備</small></div><i aria-hidden="true">›</i></Link>
          <Link href="/preferences"><span aria-hidden="true">◎</span><div><strong>マッチング条件</strong><small>年齢・距離・地域・プロフィール</small></div><i aria-hidden="true">›</i></Link>
          <Link href="/rules"><span aria-hidden="true">✦</span><div><strong>AI会話ルール</strong><small>口調・話題・禁止事項・報告条件</small></div><i aria-hidden="true">›</i></Link>
        </section>
      </details>

      <section className="surface-card p-5 sm:p-6" aria-labelledby="activity-title">
        <div className="card-heading p-0 pb-5"><h2 id="activity-title" className="section-title">最近の報告</h2><span className={`status-pill ${dashboard?.worker.status === 'online' || dashboard?.worker.status === 'busy' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><span className={`status-dot ${dashboard?.worker.status === 'online' || dashboard?.worker.status === 'busy' ? 'bg-emerald-500' : 'bg-amber-500'}`} />{dashboard ? workerStatusLabel(dashboard.worker.status) : '未接続'}</span></div>
        <ol className="activity-list">
          {dashboard?.reports.slice(0, 5).map((report) => <li key={report.id}><span className="activity-icon bg-emerald-50 text-emerald-700">T</span><div><strong>{report.kind === 'goal_reached' ? '条件達成を報告' : report.kind === 'automation_failure' ? '自動処理を安全停止' : '確認依頼を報告'}</strong><p>{report.text.split('\n').filter(Boolean).slice(1, 2).join(' ') || report.status}</p></div><time dateTime={report.createdAt}>{formatRelativeTime(report.createdAt)}</time></li>)}
          {dashboard?.reports.length === 0 && <li><span className="activity-icon bg-slate-100 text-slate-500">—</span><div><strong>まだ報告はありません</strong><p>条件達成や確認依頼がここに表示されます。</p></div></li>}
        </ol>
      </section>
    </div>
  );

  const renderMatches = () => (
    <div className="page-stack">
      <div className="page-heading"><div><h1>候補</h1><p>条件との一致度が高い順に表示します。</p></div><Link href="/preferences" className="secondary-button">条件を編集</Link></div>
      <section className="match-summary" aria-label="候補の処理状況"><div><span>現在の候補</span><strong>{candidates.length}</strong></div><div><span>いいね済み</span><strong>{dashboard?.metrics.liked ?? 0}</strong></div><div><span>マッチ済み</span><strong>{dashboard?.metrics.matched ?? 0}</strong></div></section>
      <section className="candidate-grid" aria-label="いいね候補一覧">
        {candidates.map((candidate, index) => {
          const isLiked = likedCandidates.includes(candidate.id) || candidate.status === 'liked';
          return (
            <article key={candidate.id} className="candidate-card">
              <div className="flex items-start justify-between"><Avatar initials={candidate.initials} color={avatarColors[index % avatarColors.length]} size="lg" /><span className="match-score"><strong>{candidate.score}</strong><small>%</small></span></div>
              <h2>{candidate.name}</h2><p>{[candidate.age ? `${candidate.age}歳` : null, candidate.provider, candidate.location].filter(Boolean).join(' · ')}</p>
              <div className="mt-4 flex flex-wrap gap-2">{(dashboard?.rule.topics ?? []).slice(0, 3).map((tag) => <span key={tag} className="topic-chip">{tag}</span>)}</div>
              <div className="ai-note"><span aria-hidden="true">✦</span><p><strong>候補スコア</strong>設定した年齢・距離・テーマ条件との一致度です。</p></div>
              <div className="mt-5 grid grid-cols-[44px_1fr] gap-2"><button type="button" onClick={() => void archiveCandidate(candidate)} className="icon-button" aria-label={`${candidate.name}さんを候補から外す`}>−</button><button type="button" disabled={isLiked} onClick={() => void likeCandidate(candidate)} className="primary-button">{isLiked ? 'いいね済み' : 'いいねを予約'}</button></div>
            </article>
          );
        })}
        {candidates.length === 0 && <div className="empty-state candidate-empty"><span aria-hidden="true">♡</span><h2>候補を収集中です</h2><p>アプリ接続とブラウザワーカーが稼働すると、条件に合う候補が表示されます。</p><button type="button" onClick={() => showModal('connect')} className="primary-button">アプリを接続</button></div>}
      </section>
    </div>
  );

  const renderSettings = () => (
    <div className="page-stack max-w-4xl">
      <div className="page-heading"><div><h1>設定</h1><p>接続と自動化を管理します。</p></div></div>
      {dashboard?.user.role === 'admin' && <section className="settings-card" aria-labelledby="admin-title">
        <div className="settings-heading"><div><p className="eyebrow">ADMIN</p><h2 id="admin-title">管理者ページ</h2></div><span className="safe-badge">管理者</span></div>
        <Link href="/admin" className="settings-row"><span><strong>アカウントと招待を管理</strong><small>登録者一覧、利用状況、停止、期限付き招待を管理します</small></span><span aria-hidden="true">›</span></Link>
      </section>}
      <section className="settings-card" aria-labelledby="operation-title">
          <div className="settings-heading"><div><p className="eyebrow">AUTOPILOT</p><h2 id="operation-title">AI運転</h2></div><button type="button" role="switch" aria-checked={isActive} disabled={isSavingState} onClick={() => isActive ? showModal('stop') : void persistAutomationState(true)} className={`switch-control ${isActive ? 'is-on' : ''}`}><span aria-hidden="true" /><b>{isSavingState ? '保存中' : isActive && dashboard?.readiness.level === 'ready' ? '運転中' : isActive ? '準備中' : 'オフ'}</b></button></div>
        <Link href="/preferences" className="settings-row"><span><strong>マッチング条件</strong><small>{minAge}〜{maxAge}歳 · {radiusKm}km · 地域・プロフィール条件</small></span><span aria-hidden="true">›</span></Link>
        <Link href="/rules" className="settings-row"><span><strong>AI会話ルール</strong><small>{automationModeLabel(autoMode)} · 確信度{minimumConfidence}%以上 · テーマと禁止事項</small></span><span aria-hidden="true">›</span></Link>
        <div className="settings-row-static"><span><strong>本人承認ガード</strong><small>日程確定・連絡先交換・本人確認・禁止テーマは本人へ戻します</small></span><span className="safe-badge">常時有効</span></div>
      </section>
      <section className="settings-card" aria-labelledby="identity-hub-title">
        <div className="settings-heading"><div><p className="eyebrow">REGISTRATION HUB</p><h2 id="identity-hub-title">アカウント作成情報</h2></div><span className="safe-badge">暗号化</span></div>
        <Link href="/identity" className="settings-row"><span><strong>共通プロフィール・パスワード・本人確認書類</strong><small>登録に使う秘密情報を暗号化して一元管理</small></span><span aria-hidden="true">›</span></Link>
        <div className="settings-row-static"><span><strong>無断送信しないもの</strong><small>サービス用パスワード・本人確認書類・認証メール本文</small></span><span className="safe-badge">保護</span></div>
      </section>
      <section className="settings-card" aria-labelledby="connections-title">
        <div className="settings-heading"><div><p className="eyebrow">CONNECTIONS</p><h2 id="connections-title">接続サービス</h2></div><span className={`tiny-status ${apps.some((app) => app.state !== '同期済み') ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{apps.length}件</span></div>
        {apps.map((app) => <button type="button" key={app.name} className="settings-row" onClick={() => void connectProvider(app.provider)}><span className={`app-mark ${app.tone}`}>{app.label}</span><span className="flex-1"><strong>{app.name}</strong><small>{app.state} · {app.detail} · 接続を再確認</small></span><span aria-hidden="true">›</span></button>)}
        <Link href="/services" className="settings-row"><span><strong>使用可能サービス一覧</strong><small>ログイン・登録準備・Web版・接続状態を確認</small></span><span aria-hidden="true">›</span></Link>
        <button type="button" className="add-service-button" onClick={() => showModal('connect')}>＋ 複数アプリを一括セットアップ</button>
      </section>
      <section className="settings-card" aria-labelledby="worker-title">
        <div className="settings-heading"><div><p className="eyebrow">LOCAL WORKER</p><h2 id="worker-title">ブラウザワーカー</h2></div><span className={`safe-badge ${dashboard?.worker.status === 'offline' || dashboard?.worker.status === 'degraded' ? 'is-muted' : ''}`}>{dashboard ? workerStatusLabel(dashboard.worker.status) : '未接続'}</span></div>
        <div className="settings-row-static"><span><strong>AI返信生成</strong><small>{dashboard?.worker.capabilities.includes('reply_generation') ? '文章生成を利用できます' : '常時稼働PCのワーカーにOPENAI_API_KEYを設定して再起動してください'}</small></span><span className={`tiny-status ${dashboard?.worker.capabilities.includes('reply_generation') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{dashboard?.worker.capabilities.includes('reply_generation') ? '利用可' : '設定待ち'}</span></div>
        <button type="button" onClick={() => void copyWorkerUserId()} className="settings-row"><span><strong>ワーカー用ユーザーIDをコピー</strong><small>ローカルワーカーの WORKER_USER_ID に設定します</small></span><span aria-hidden="true">⧉</span></button>
        <div className="settings-row-static"><span><strong>最終接続</strong><small>{dashboard?.worker.lastSeenAt ? formatRelativeTime(dashboard.worker.lastSeenAt) : 'まだ接続されていません'}</small></span><span className="tiny-status bg-slate-100 text-slate-600">v{dashboard?.worker.version ?? '—'}</span></div>
          <Link href="/worker-setup" className="settings-row"><span><strong>ワーカー認証を管理</strong><small>このアカウント専用の接続トークンを発行・無効化</small></span><span aria-hidden="true">›</span></Link>
          <Link href="/support#worker-recovery" className="settings-row"><span><strong>起動・設定不足を直す</strong><small>オフライン、設定不足、返信案が作られない場合の確認手順</small></span><span aria-hidden="true">›</span></Link>
      </section>
      <section className="settings-card" aria-labelledby="reports-title">
        <div className="settings-heading"><div><p className="eyebrow">REPORTS</p><h2 id="reports-title">Telegram報告</h2></div><span className={`safe-badge ${dashboard?.user.telegramLinked ? '' : 'is-muted'}`}>{dashboard?.user.telegramLinked ? '接続済み' : '未接続'}</span></div>
        {!dashboard?.user.telegramLinked && <button type="button" onClick={() => void connectTelegram()} className="settings-row"><span><strong>Telegramを接続</strong><small>10分間有効な安全な接続リンクを発行します</small></span><span aria-hidden="true">›</span></button>}
        {dashboard?.user.telegramLinked && <button type="button" onClick={() => void unlinkTelegram()} className="settings-row"><span><strong>Telegram接続を解除</strong><small>報告先との連携だけを安全に削除します</small></span><span aria-hidden="true">›</span></button>}
        <Link href="/telegram-learning" className="settings-row"><span><strong>報告・会話の書き方を学習</strong><small>他グループからL婚サポート２へ転送した例を、あなた専用ルールへ反映</small></span><span aria-hidden="true">›</span></Link>
        <div className="settings-row-static"><span><strong>達成時の報告</strong><small>マイページ・会話スクリーンショット・テンプレ文</small></span><span className={`tiny-status ${dashboard?.user.telegramLinked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{dashboard?.user.telegramLinked ? '自動' : '接続待ち'}</span></div>
        <div className="settings-row-static"><span><strong>定期サマリー</strong><small>毎日 21:00 · いいね・マッチ・会話・判断待ち</small></span><span className={`tiny-status ${dashboard?.user.telegramLinked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{dashboard?.user.telegramLinked ? '自動' : '接続待ち'}</span></div>
      </section>
      <section className="settings-card" aria-labelledby="billing-title">
        <div className="settings-heading"><div><p className="eyebrow">BILLING</p><h2 id="billing-title">プランとお支払い</h2></div><span className={`tiny-status ${billing?.subscription?.active ? 'bg-emerald-50 text-emerald-700' : billing?.subscription && ['past_due', 'unpaid'].includes(billing.subscription.status) ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{isBillingLoading ? '読込中' : billing?.subscription ? billingStatusLabel(billing.subscription.status) : billing?.enabled ? '未登録' : '準備中'}</span></div>
        <div className="settings-row-static"><span><strong>個人版クレジット</strong><small>返信案・ルール・接続準備のアプリ内回数制限なし</small></span><span className="safe-badge">全開放</span></div>
        {isBillingLoading && <div className="settings-row-static"><span><strong>契約状態を確認中</strong><small>Stripeの契約情報を安全に読み込んでいます</small></span><span className="state-spinner is-small" aria-hidden="true" /></div>}
        {!isBillingLoading && !billing && <button type="button" className="settings-row" onClick={() => void loadBilling()}><span><strong>契約状態を読み込めませんでした</strong><small>接続を確認して再試行してください</small></span><span aria-hidden="true">↻</span></button>}
        {!isBillingLoading && billing && !billing.subscription && !billing.enabled && <div className="settings-row-static"><span><strong>{billing.planName}</strong><small>{billing.configured ? '本番開始スイッチはオフです。現在は請求されません' : '料金とStripe接続を設定するまで、申込みと請求は開始されません'}</small></span><span className="safe-badge is-muted">課金なし</span></div>}
        {!isBillingLoading && billing?.enabled && !billing.subscription && <><div className="settings-row-static"><span><strong>{billing.planName}</strong><small>金額と更新周期はStripe決済画面で確認してから確定します</small></span><span className="safe-badge">申込可能</span></div><button type="button" disabled={Boolean(billingAction)} className="settings-row" onClick={() => void openStripeFlow('checkout')}><span><strong>Stripeでサブスクを開始</strong><small>カード情報はMatchPilotへ保存せず、Stripeが安全に管理します</small></span><span aria-hidden="true">{billingAction === 'checkout' ? '…' : '›'}</span></button></>}
        {!isBillingLoading && billing?.subscription && <><div className="settings-row-static"><span><strong>{billing.planName} · {billingStatusLabel(billing.subscription.status)}</strong><small>{billing.subscription.cancelAtPeriodEnd ? `${formatBillingDate(billing.subscription.currentPeriodEnd)}で終了予定` : billing.subscription.trialEnd ? `無料期間は${formatBillingDate(billing.subscription.trialEnd)}まで` : billing.subscription.currentPeriodEnd ? `次回更新 ${formatBillingDate(billing.subscription.currentPeriodEnd)}` : 'Stripeと契約状態を同期済み'}</small></span><span className={`safe-badge ${billing.subscription.active ? '' : 'is-muted'}`}>{billing.subscription.active ? '有効' : '要確認'}</span></div>{billing.canManage && <button type="button" disabled={Boolean(billingAction)} className="settings-row" onClick={() => void openStripeFlow('portal')}><span><strong>支払い方法・領収書・解約を管理</strong><small>Stripeの顧客ポータルを開きます</small></span><span aria-hidden="true">{billingAction === 'portal' ? '…' : '›'}</span></button>}{billing.enabled && ['canceled', 'incomplete_expired'].includes(billing.subscription.status) && <button type="button" disabled={Boolean(billingAction)} className="settings-row" onClick={() => void openStripeFlow('checkout')}><span><strong>サブスクを再開</strong><small>新しいStripe決済画面から申し込みます</small></span><span aria-hidden="true">›</span></button>}</>}
      </section>
      <section className="settings-card" aria-labelledby="privacy-title">
        <div className="settings-heading"><div><p className="eyebrow">PRIVACY</p><h2 id="privacy-title">データとプライバシー</h2></div></div>
        <div className="settings-row-static"><span><strong>学習メモリ</strong><small>承認・修正文と直近の会話履歴から文体を継続適応</small></span><span className="safe-badge">継続適応</span></div>
        <button type="button" className="settings-row" onClick={() => showModal('audit')}><span><strong>監査ログ</strong><small>送信・停止・接続・失敗と再試行を記録</small></span><span aria-hidden="true">›</span></button>
        <button type="button" className="settings-row" onClick={() => void exportPersonalData()}><span><strong>個人データを書き出す</strong><small>接続・会話・ルール・監査記録をJSONで保存</small></span><span aria-hidden="true">⇩</span></button>
        <button type="button" className="settings-row" onClick={() => showModal('password')}><span><strong>パスワードを変更</strong><small>変更後はこの端末以外のセッションを終了します</small></span><span aria-hidden="true">›</span></button>
        <Link href="/security" className="settings-row"><span><strong>セキュリティ・復旧・総合テスト</strong><small>2段階認証、暗号化バックアップ、障害診断をまとめて管理</small></span><span aria-hidden="true">›</span></Link>
        <Link href="/privacy" className="settings-row"><span><strong>プライバシーポリシー</strong><small>取得する情報、利用目的、保存期間を確認</small></span><span aria-hidden="true">›</span></Link>
        <Link href="/terms" className="settings-row"><span><strong>利用規約</strong><small>安全な利用条件と外部サービスとの関係を確認</small></span><span aria-hidden="true">›</span></Link>
        <button type="button" className="settings-row danger-row" onClick={() => showModal('deleteAccount')}><span><strong>アカウントとデータを削除</strong><small>会話、画像、ルール、接続情報を完全に削除</small></span><span aria-hidden="true">›</span></button>
        <button type="button" className="settings-row" onClick={() => void signOut()}><span><strong>ログアウト</strong><small>この端末のMatchPilotセッションを終了</small></span><span aria-hidden="true">›</span></button>
      </section>
      <section className="settings-card" aria-labelledby="app-title">
        <div className="settings-heading"><div><h2 id="app-title">アプリとサポート</h2></div><span className="safe-badge">{isStandalone ? '追加済み' : '全端末対応'}</span></div>
        <button type="button" className="settings-row" onClick={() => void installApp()}><span><strong>{isStandalone ? 'ホーム画面から利用中' : 'ホーム画面に追加'}</strong><small>ブラウザを閉じても、アプリのようにすぐ開けます</small></span><span aria-hidden="true">{isStandalone ? '✓' : '›'}</span></button>
        <Link href="/support" className="settings-row"><span><strong>ヘルプとサポート</strong><small>不具合時の復旧、データ削除、端末への追加方法</small></span><span aria-hidden="true">›</span></Link>
        <Link href="/sources" className="settings-row"><span><strong>設計ソースと比較調査</strong><small>過去システム、世界の類似製品、公式技術資料、サービスURL</small></span><span aria-hidden="true">›</span></Link>
      </section>
    </div>
  );

  return (
    <main className={`min-h-screen bg-[#f4f6f8] text-[#18212f] ${showAppChrome ? '' : 'is-authentication'}`}>
      <a href="#main-content" className="skip-link">メインコンテンツへ移動</a>
      {!showAppChrome && <div className="theme-float"><ThemeToggle /></div>}
      <div className="app-shell">
        {showAppChrome && <aside className="desktop-sidebar">
          <button type="button" onClick={() => switchView('home')} className="brand-lockup" aria-label="MatchPilot ホーム"><span className="brand-mark">M</span><span><strong>MatchPilot</strong><small>アプリを一つに</small></span></button>
          <nav aria-label="メインナビゲーション" className="desktop-nav">
            <button type="button" onClick={() => switchView('home')} aria-current={activeView === 'home' ? 'page' : undefined}><span className="nav-icon" aria-hidden="true">⌂</span><span>ホーム</span></button>
            <Link href="/services"><span className="nav-icon" aria-hidden="true">▦</span><span>アプリ一覧</span></Link>
            <Link href="/mail"><span className="nav-icon" aria-hidden="true">✉</span><span>メール管理</span></Link>
            <Link href="/preferences"><span className="nav-icon" aria-hidden="true">◎</span><span>マッチング条件</span></Link>
            <Link href="/rules"><span className="nav-icon" aria-hidden="true">✦</span><span>AI会話ルール</span></Link>
            <button type="button" onClick={() => switchView('matches')} aria-current={activeView === 'matches' ? 'page' : undefined}><span className="nav-icon" aria-hidden="true">♡</span><span>候補</span></button>
            <button type="button" onClick={() => switchView('settings')} aria-current={activeView === 'settings' ? 'page' : undefined}><span className="nav-icon" aria-hidden="true">⚙</span><span>設定</span></button>
          </nav>
          <div className="sidebar-system-card"><div className="flex items-center justify-between"><strong>システム状態</strong><span className={`status-dot ${dashboard && (dashboard.worker.status === 'online' || dashboard.worker.status === 'busy') ? 'bg-emerald-500' : dashboard?.worker.status === 'degraded' ? 'bg-amber-500' : 'bg-slate-400'}`} /></div><p>ブラウザワーカー</p><span>{!dashboard ? '未接続' : `${workerStatusLabel(dashboard.worker.status)} · ${formatRelativeTime(dashboard.worker.lastSeenAt)}`}</span><p>Telegram</p><span>{dashboard?.user.telegramLinked ? '接続済み' : '未接続'}</span></div>
          <button type="button" disabled={!dashboard} onClick={() => isActive ? showModal('stop') : void persistAutomationState(true)} className={`sidebar-control ${isActive ? '' : 'is-paused'}`}><span aria-hidden="true">{isActive ? 'Ⅱ' : '▶'}</span><span><strong>{!dashboard ? 'ログインが必要' : isActive ? 'すべて停止' : '運転を再開'}</strong><small>{!dashboard ? '認証後に操作できます' : isActive ? '確認して安全に停止' : '保留中の処理を再開'}</small></span></button>
        </aside>}

        <section className="workspace">
          {showAppChrome && <header className="app-header">
            <button type="button" onClick={() => switchView('home')} className="mobile-brand" aria-label="MatchPilot ホーム"><span>M</span><strong>MatchPilot</strong></button>
            <div className="header-status"><span className={`status-dot ${!dashboard ? 'bg-slate-400' : !isOnline || dashboard.worker.status === 'degraded' || dashboard.readiness.level !== 'ready' ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden="true" /><span>{!dashboard ? 'ログインが必要' : !isOnline ? '端末がオフライン' : !isActive ? '自動運転を停止中' : dashboard.readiness.level === 'ready' ? '許可済み運転中' : '準備モード・外部操作停止'}</span></div>
            <div className="ml-auto flex items-center gap-2"><ThemeToggle /><button type="button" disabled={!dashboard || isSavingState} onClick={() => isActive ? showModal('stop') : void persistAutomationState(true)} className={`header-operation-button ${isActive ? 'is-active' : ''}`} aria-label={isActive ? 'すべての自動操作を停止' : '自動運転を再開'}><span aria-hidden="true">{isSavingState ? '…' : isActive ? 'Ⅱ' : '▶'}</span></button><button type="button" onClick={() => showModal('notifications')} className="header-icon-button" aria-label="通知を開く"><span aria-hidden="true">通知</span>{Boolean(dashboard?.metrics.needsReview) && <i aria-label={`未読${dashboard?.metrics.needsReview}件`}>{dashboard?.metrics.needsReview}</i>}</button><button type="button" onClick={() => switchView('settings')} className="profile-button" aria-label="設定を開く">{dashboard?.user.displayName.slice(0, 3).toUpperCase() ?? 'YOU'}</button></div>
          </header>}
          {!isOnline && <div role="status" className="offline-banner">オフラインです。変更は接続が戻るまで送信されません。</div>}
          <div id="main-content" tabIndex={-1} className="main-content">
            {isLoading ? <AppState variant={showAppChrome ? 'default' : 'auth'} title="データを読み込んでいます" description="安全な接続を確認しています。" busy /> : requiresLogin ? renderAuthentication() : loadError ? <AppState variant={showAppChrome ? 'default' : 'auth'} title="読み込めませんでした" description={loadError} action={<button type="button" onClick={() => { setIsLoading(true); void loadDashboard(); }} className="primary-button">再試行</button>} /> : <>
              {activeView === 'home' && renderHome()}
              {activeView === 'matches' && renderMatches()}
              {activeView === 'settings' && renderSettings()}
            </>}
          </div>
        </section>
      </div>

      {showAppChrome && <nav className="mobile-tabbar" aria-label="メインナビゲーション">
        <button type="button" onClick={() => switchView('home')} aria-current={activeView === 'home' ? 'page' : undefined}><span className="tab-icon" aria-hidden="true">⌂</span><span>ホーム</span></button>
        <Link href="/services"><span className="tab-icon" aria-hidden="true">▦</span><span>アプリ</span></Link>
        <Link href="/mail"><span className="tab-icon" aria-hidden="true">✉</span><span>メール</span></Link>
        <Link href="/rules"><span className="tab-icon" aria-hidden="true">✦</span><span>AIルール</span></Link>
        <button type="button" onClick={() => switchView('settings')} aria-current={activeView === 'settings' ? 'page' : undefined}><span className="tab-icon" aria-hidden="true">⚙</span><span>設定</span></button>
      </nav>}

      {modal === 'stop' && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><section role="dialog" aria-modal="true" aria-labelledby="stop-title" aria-describedby="stop-description" className="dialog-card"><span className="dialog-symbol danger" aria-hidden="true">Ⅱ</span><h2 id="stop-title">すべての自動操作を停止しますか？</h2><p id="stop-description">新しいいいね・返信・巡回を停止します。すでに送信済みの操作は取り消せません。</p><div className="dialog-actions"><button ref={modalFocusRef} type="button" onClick={closeModal} className="secondary-button">キャンセル</button><button type="button" onClick={confirmStop} className="danger-button">すべて停止</button></div></section></div>}

      {modal === 'notifications' && <div className="modal-backdrop items-start justify-end p-0" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><section role="dialog" aria-modal="true" aria-labelledby="notifications-title" className="notification-sheet"><div className="flex items-center justify-between"><h2 id="notifications-title">通知</h2><button ref={modalFocusRef} type="button" onClick={closeModal} className="close-button" aria-label="閉じる">×</button></div>{conversations.filter((chat) => chat.needsReview).map((chat) => <div key={chat.id} className="notification-item"><span className="bg-amber-100 text-amber-800">T</span><div><strong>{chat.name}さんの確認をTelegramへ送信済み</strong><p>{chat.stage}</p><time dateTime={chat.dateTime}>{chat.time}</time></div></div>)}{apps.filter((app) => app.state !== '同期済み').map((app) => <Link key={app.id} href="/services" onClick={closeModal} className="notification-item"><span className="bg-rose-100 text-rose-700">{app.label}</span><div><strong>{app.name}のログインが必要です</strong><p>{app.state} · {app.detail}</p></div></Link>)}{conversations.every((chat) => !chat.needsReview) && apps.every((app) => app.state === '同期済み') && <div className="empty-state"><span aria-hidden="true">✓</span><h2>新しい通知はありません</h2><p>対応が必要な項目だけをここに表示します。</p></div>}</section></div>}

      {modal === 'audit' && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><section role="dialog" aria-modal="true" aria-labelledby="audit-title" className="dialog-card audit-dialog"><div className="flex items-center justify-between"><div><p className="eyebrow">AUDIT TRAIL</p><h2 id="audit-title">監査ログ</h2></div><button ref={modalFocusRef} type="button" onClick={closeModal} className="close-button" aria-label="閉じる">×</button></div><ol className="audit-list">{dashboard?.auditEvents.map((event) => <li key={event.id}><span className={`audit-state is-${event.status}`}>{auditStatusLabel(event.status)}</span><div><strong>{auditTypeLabel(event.type)}</strong><p>{event.lastError || `試行 ${event.attempts}回`}</p><time dateTime={event.createdAt}>{formatRelativeTime(event.createdAt)}</time></div></li>)}{dashboard?.auditEvents.length === 0 && <li className="audit-empty">記録はまだありません。</li>}</ol></section></div>}

      {modal === 'connect' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="connect-title" className="dialog-card rules-dialog">
            <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">ONE-TAP SETUP</p><h2 id="connect-title">複数アプリを一括セットアップ</h2></div><button ref={modalFocusRef} type="button" onClick={closeModal} className="close-button" aria-label="閉じる">×</button></div>
            <p className="connection-intro">使うサービスをまとめて選択すると、公式ページを順番に開く準備を作ります。登録情報ハブに保存したメール・電話番号・共通プロフィールを再利用できます。</p>
            <fieldset className="rule-fieldset"><legend>セットアップ方法</legend><div className="mode-grid"><button type="button" aria-pressed={connectionIntent === 'existing'} onClick={() => setConnectionIntent('existing')}><strong>既存アカウントを接続</strong><small>公式ログイン画面へ進む</small></button><button type="button" aria-pressed={connectionIntent === 'new'} onClick={() => setConnectionIntent('new')}><strong>新規登録画面をまとめて準備</strong><small>入力補助後、送信前に停止</small></button></div></fieldset>
            <fieldset className="rule-fieldset"><legend>サービスを選択（最大5件）</legend><div className="provider-grid">{connectableProviders.map((connector) => <button key={connector.id} type="button" aria-pressed={selectedProviders.includes(connector.id)} onClick={() => toggleSelectedProvider(connector.id)}><span className={`app-mark ${providerPresentation(connector.id).tone}`}>{providerPresentation(connector.id).label}</span><span><strong>{connector.label}</strong><small>{selectedProviders.includes(connector.id) ? '選択済み' : 'タップして追加'}</small></span></button>)}</div></fieldset>
            <div className="setup-summary"><div><strong>共通して準備するもの</strong><span>{selectedProviders.length} / 5 サービス選択</span></div>{connectableProviders.filter((connector) => selectedProviders.includes(connector.id)).map((connector) => <p key={connector.id}><b>{connector.label}</b><span>{connector.minimumSetupFields.join('・')}</span></p>)}</div>
            <p className="provider-note"><strong>登録準備の範囲:</strong> 公式画面の起動、共通プロフィール、許可済みパスワードの補助入力までです。このボタンだけでアカウント作成は完了せず、送信、CAPTCHA、OTP、本人確認、規約同意では停止して本人へ通知します。</p>
            <div className="safety-note"><span aria-hidden="true">✓</span><p><strong>秘密情報を用途別に保護します</strong>サービス用パスワードと本人確認書類は暗号化保管庫へ保存し、許可した登録画面への補助入力以外には使用しません。最終送信は本人操作です。<Link href="/identity">登録情報ハブを編集</Link></p></div>
            <div className="dialog-actions"><button type="button" onClick={closeModal} className="secondary-button">キャンセル</button><button type="button" disabled={selectedProviders.length === 0} onClick={() => void connectSelectedProviders()} className="primary-button">{selectedProviders.length}件の登録準備を開始</button></div>
          </section>
        </div>
      )}

      {modal === 'deleteAccount' && (
        <div className="modal-backdrop" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="delete-account-title" aria-describedby="delete-account-description" className="dialog-card delete-account-dialog">
            <div className="flex items-start justify-between gap-4"><div><span className="danger-kicker">取り消せません</span><h2 id="delete-account-title">アカウントを削除</h2></div><button ref={modalFocusRef} type="button" onClick={closeModal} className="close-button" aria-label="閉じる">×</button></div>
            <p id="delete-account-description">登録情報ハブ、Google接続トークン、会話、候補、スクリーンショット、接続、学習ルールを削除し、稼働中のStripe契約がある場合は停止します。各マッチングサービス側のアカウントは削除されません。</p>
            <label className="delete-field"><span>現在のパスワード</span><input type="password" autoComplete="current-password" minLength={8} maxLength={128} value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="8文字以上" /></label>
            <label className="delete-field"><span>確認のため「削除」と入力</span><input type="text" autoComplete="off" maxLength={2} value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="削除" /></label>
            {deleteError && <p className="delete-error" role="alert">{deleteError}</p>}
            <div className="dialog-actions"><button type="button" onClick={closeModal} className="secondary-button">キャンセル</button><button type="button" disabled={isDeletingAccount || unicodeLength(deletePassword) < 8 || deleteConfirmation !== '削除'} onClick={() => void deleteAccount()} className="danger-button">{isDeletingAccount ? '削除中…' : '完全に削除'}</button></div>
          </section>
        </div>
      )}

      {modal === 'password' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="password-title" aria-describedby="password-description" className="dialog-card delete-account-dialog">
            <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">ACCOUNT SECURITY</p><h2 id="password-title">パスワードを変更</h2></div><button ref={modalFocusRef} type="button" onClick={closeModal} className="close-button" aria-label="閉じる">×</button></div>
            <p id="password-description">新しいパスワードへ変更すると、この端末を残して、ほかの端末のMatchPilotセッションを終了します。</p>
            <label className="delete-field"><span>現在のパスワード</span><input type="password" autoComplete="current-password" minLength={8} maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="現在のパスワード" /></label>
            <label className="delete-field"><span>新しいパスワード</span><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="8文字以上" /></label>
            <label className="delete-field"><span>新しいパスワードを再入力</span><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPasswordConfirmation} onChange={(event) => setNewPasswordConfirmation(event.target.value)} placeholder="もう一度入力" /></label>
            {newPasswordConfirmation && newPassword !== newPasswordConfirmation && <p className="delete-error" role="alert">新しいパスワードが一致しません。</p>}
            {passwordChangeError && <p className="delete-error" role="alert">{passwordChangeError}</p>}
            <div className="dialog-actions"><button type="button" onClick={closeModal} className="secondary-button">キャンセル</button><button type="button" disabled={isChangingPassword || unicodeLength(currentPassword) < 8 || unicodeLength(newPassword) < 8 || newPassword !== newPasswordConfirmation} onClick={() => void changePassword()} className="primary-button">{isChangingPassword ? '変更中…' : 'パスワードを変更'}</button></div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status" aria-live="polite"><span>{toast.message}</span>{toast.actionLabel && toast.onAction && <button type="button" onClick={() => { toast.onAction?.(); setToast(null); }}>{toast.actionLabel}</button>}<button type="button" aria-label="通知を閉じる" onClick={() => setToast(null)}>×</button></div>}
    </main>
  );
}

function AppState({ title, description, action, busy = false, variant = 'default' }: { title: string; description: string; action?: React.ReactNode; busy?: boolean; variant?: 'default' | 'auth' }) {
  if (variant === 'auth') {
    return <section className="app-state is-auth" aria-live="polite" aria-busy={busy}><div className="auth-brand"><span className="brand-mark">M</span><span><strong>MatchPilot</strong><small>アプリを一つに</small></span></div><div className="auth-card">{busy ? <span className="state-spinner" aria-hidden="true" /> : <span className="auth-kicker">安全なログイン</span>}<h1>{title}</h1><p>{description}</p>{action}</div><div className="auth-assurances" aria-label="セキュリティ情報"><span>暗号化通信</span><span>全端末対応</span><span>秘密情報は各社画面だけ</span></div></section>;
  }
  return <section className="app-state" aria-live="polite" aria-busy={busy}><span className={busy ? 'state-spinner' : 'state-symbol'} aria-hidden="true">{busy ? '' : 'M'}</span><h1>{title}</h1><p>{description}</p>{action}</section>;
}
