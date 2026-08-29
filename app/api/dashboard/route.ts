import { getDb } from '@/db';
import {
  appConnections,
  aiCredentials,
  automationJobs,
  automationRules,
  contacts,
  conversations,
  gmailConnections,
  identityProfiles,
  identityProfilePhotos,
  messages,
  reports,
  serviceCredentials,
  users,
  workerHeartbeats,
} from '@/db/schema';
import { getPersonalUser } from '@/app/personal-auth';
import type { DashboardPayload } from '@/lib/dashboard-types';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) {
    return Response.json(
      { error: 'authentication_required' },
      { status: 401 },
    );
  }

  const db = getDb();
  const now = new Date();
  await db
    .insert(users)
    .values({
      id: authenticatedUser.userId,
      email: authenticatedUser.email,
      displayName: authenticatedUser.displayName,
      automationState: 'paused',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: authenticatedUser.email,
        displayName: authenticatedUser.displayName,
        updatedAt: now,
      },
    });

  let ruleRows = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.userId, authenticatedUser.userId))
    .limit(1);

  if (ruleRows.length === 0) {
    await db.insert(automationRules).values({
      id: `rule_${authenticatedUser.userId}`,
      userId: authenticatedUser.userId,
      name: '既定の自動化ルール',
      minAge: 30,
      maxAge: 70,
      radiusKm: 30,
      topicsJson: JSON.stringify(['旅行', '食事', '映画', '仕事', 'サウナ', '休日']),
      blockedTopicsJson: JSON.stringify(['金銭', '投資', '宗教', '認証コード']),
      minimumConfidence: 85,
      automationMode: 'full_auto',
      successConditionJson: JSON.stringify({
        requireApprovalForScheduling: true,
        requireApprovalForContactExchange: false,
        contactExchangeDirection: 'receive_only',
        requiredConversationFields: ['marriage_intent', 'line_contact'],
        goalKeywords: ['相手が婚活意思を明示した', '相手からLINEを受領した'],
        goalTarget: 5,
        preferredLocations: [],
        requiredProfileKeywords: [],
        excludedProfileKeywords: ['勧誘', '投資', '既婚'],
        desiredRelationship: '結婚を希望する相手と、真剣な婚活を進める',
        conversationTone: 'natural',
        replyLength: 'balanced',
        questionFrequency: 'balanced',
        persona: '',
        forbiddenPhrases: [],
        escalationTriggers: ['金銭の話', '本人確認情報', '強い勧誘'],
      }),
      createdAt: now,
      updatedAt: now,
    });
    ruleRows = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.userId, authenticatedUser.userId))
      .limit(1);
  }

  const [userRows, connectionRows, conversationRows, contactRows, workerRows, reportRows, auditRows, identityRows, gmailRows, profilePhotoRows, serviceCredentialRows, aiCredentialRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, authenticatedUser.userId)).limit(1),
    db.select().from(appConnections).where(eq(appConnections.userId, authenticatedUser.userId)).orderBy(asc(appConnections.label)),
    db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        status: conversations.status,
        automationMode: conversations.automationMode,
        stage: conversations.stage,
        summary: conversations.summary,
        confidence: conversations.confidence,
        lastMessageAt: conversations.lastMessageAt,
        contactName: contacts.displayName,
        contactAge: contacts.age,
        contactLocation: contacts.location,
        profileUrl: contacts.profileUrl,
        provider: contacts.provider,
        providerLabel: appConnections.label,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .innerJoin(appConnections, eq(conversations.connectionId, appConnections.id))
      .where(eq(conversations.userId, authenticatedUser.userId))
      .orderBy(desc(conversations.lastMessageAt)),
    db.select().from(contacts).where(eq(contacts.userId, authenticatedUser.userId)).orderBy(desc(contacts.score)),
    db.select().from(workerHeartbeats).where(eq(workerHeartbeats.userId, authenticatedUser.userId)).orderBy(desc(workerHeartbeats.lastSeenAt)).limit(1),
    db.select().from(reports).where(eq(reports.userId, authenticatedUser.userId)).orderBy(desc(reports.createdAt)).limit(20),
    db
      .select({ id: automationJobs.id, type: automationJobs.type, status: automationJobs.status, attempts: automationJobs.attempts, lastError: automationJobs.lastError, createdAt: automationJobs.createdAt })
      .from(automationJobs)
      .where(eq(automationJobs.userId, authenticatedUser.userId))
      .orderBy(desc(automationJobs.createdAt))
      .limit(50),
    db
      .select({
        registrationEmailCiphertext: identityProfiles.registrationEmailCiphertext,
        phoneNumberCiphertext: identityProfiles.phoneNumberCiphertext,
        nicknameCiphertext: identityProfiles.nicknameCiphertext,
        birthDateCiphertext: identityProfiles.birthDateCiphertext,
        residenceCiphertext: identityProfiles.residenceCiphertext,
        phoneOwnershipConfirmed: identityProfiles.phoneOwnershipConfirmed,
        registrationAssistEnabled: identityProfiles.registrationAssistEnabled,
        gmailCodeAssistEnabled: identityProfiles.gmailCodeAssistEnabled,
      })
      .from(identityProfiles)
      .where(eq(identityProfiles.userId, authenticatedUser.userId))
      .limit(1),
    db
      .select({ status: gmailConnections.status })
      .from(gmailConnections)
      .where(eq(gmailConnections.userId, authenticatedUser.userId))
      .limit(1),
    db
      .select({ isPrimary: identityProfilePhotos.isPrimary })
      .from(identityProfilePhotos)
      .where(eq(identityProfilePhotos.userId, authenticatedUser.userId)),
    db
      .select({ registrationFillEnabled: serviceCredentials.registrationFillEnabled })
      .from(serviceCredentials)
      .where(eq(serviceCredentials.userId, authenticatedUser.userId)),
    db
      .select({ enabled: aiCredentials.enabled })
      .from(aiCredentials)
      .where(eq(aiCredentials.userId, authenticatedUser.userId))
      .limit(1),
  ]);

  const conversationIds = conversationRows.map((conversation) => conversation.id);
  const messageRows = conversationIds.length
    ? await db.select().from(messages).where(inArray(messages.conversationId, conversationIds)).orderBy(asc(messages.createdAt))
    : [];
  const messagesByConversation = new Map<string, typeof messageRows>();
  for (const message of messageRows) {
    const current = messagesByConversation.get(message.conversationId) ?? [];
    current.push(message);
    messagesByConversation.set(message.conversationId, current);
  }

  const user = userRows[0];
  const rule = ruleRows[0];
  const successCondition = parseObject(rule.successConditionJson);
  const worker = workerRows[0];
  const workerIsFresh = worker ? Date.now() - worker.lastSeenAt.getTime() < 120_000 : false;
  const workerCapabilities = parseStringArray(worker?.capabilitiesJson ?? '[]');
  const connectedServiceCount = connectionRows.filter((connection) => connection.status === 'connected').length;
  const identity = identityRows[0];
  const missingIdentityFields = [
    !identity?.registrationEmailCiphertext ? 'メール' : null,
    !identity?.phoneNumberCiphertext ? '電話番号' : null,
    !identity?.phoneOwnershipConfirmed ? '電話番号の所有確認' : null,
    !identity?.nicknameCiphertext ? 'ニックネーム' : null,
    !identity?.birthDateCiphertext ? '生年月日' : null,
    !identity?.residenceCiphertext ? '居住地' : null,
    !profilePhotoRows.some((photo) => photo.isPrimary) ? 'メイン写真' : null,
    !serviceCredentialRows.some((credential) => credential.registrationFillEnabled) ? 'サービス用パスワード' : null,
    identity?.registrationAssistEnabled !== true ? '登録入力の許可' : null,
  ].filter((value): value is string => Boolean(value));
  const identityReady = missingIdentityFields.length === 0;
  const gmailConfigured = Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
  const gmailReady = gmailConfigured && gmailRows[0]?.status === 'connected' && identityRows[0]?.gmailCodeAssistEnabled === true;
  const aiCredentialConfigured = aiCredentialRows[0]?.enabled === true;
  const telegramConfigured = Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_BOT_USERNAME?.trim());
  const telegramReady = telegramConfigured && Boolean(user.telegramChatId);
  const backupFresh = Boolean(user.lastBackupAt && now.getTime() - user.lastBackupAt.getTime() < 48 * 60 * 60 * 1000);
  const selfTestFresh = Boolean(user.lastSelfTestAt && now.getTime() - user.lastSelfTestAt.getTime() < 7 * 24 * 60 * 60 * 1000);
  const readinessChecks: DashboardPayload['readiness']['checks'] = [
    {
      id: 'worker',
      label: '常駐ブラウザ',
      status: workerIsFresh ? (worker.status === 'degraded' ? 'action' : 'ready') : 'blocked',
      detail: workerIsFresh ? (worker.status === 'degraded' ? '起動中ですが不足設定があります' : 'このPCで常時稼働中です') : 'ワーカーを起動してください',
      href: '/?view=settings#worker-title',
    },
    {
      id: 'ai',
      label: 'AI返信生成',
      status: workerIsFresh && workerCapabilities.includes('reply_generation') ? 'ready' : 'blocked',
      detail: workerCapabilities.includes('reply_generation')
        ? '返信文を生成できます'
        : aiCredentialConfigured
          ? 'AIキーは保存済みです。ワーカーへの反映を待っています'
          : 'AIキーを安全に保存してください',
      href: '/worker-setup#ai-provider',
    },
    {
      id: 'service',
      label: '実サービス接続',
      status: connectedServiceCount > 0 ? 'ready' : 'blocked',
      detail: connectedServiceCount > 0 ? `${connectedServiceCount}件でログイン確認済みです` : '接続済みサービスはまだ0件です',
      href: '/services',
    },
    {
      id: 'identity',
      label: '登録情報ハブ',
      status: identityReady ? 'ready' : 'action',
      detail: identityReady ? '登録に必要な共通情報・写真・パスワードが揃っています' : `不足：${missingIdentityFields.join('・')}`,
      href: '/identity',
    },
    {
      id: 'gmail',
      label: 'Gmail認証補助',
      status: gmailReady ? 'ready' : 'action',
      detail: gmailReady ? '認証番号候補を取得できます' : gmailConfigured ? 'Gmail接続と取得許可が必要です' : 'Google OAuthの本番設定が必要です',
      href: '/identity',
    },
    {
      id: 'telegram',
      label: 'Telegram報告',
      status: telegramReady ? 'ready' : 'action',
      detail: telegramReady ? '確認・達成報告を送信できます' : telegramConfigured ? 'Telegram Botとの接続を完了してください' : 'Telegram Botの本番設定が必要です',
      href: '/?view=settings#reports-title',
    },
    {
      id: 'security',
      label: '2段階認証',
      status: user.telegramMfaEnabled ? 'ready' : 'action',
      detail: user.telegramMfaEnabled ? 'ログイン時にTelegram確認コードを要求します' : 'Telegram 2段階認証を有効にしてください',
      href: '/security',
    },
    {
      id: 'backup',
      label: '暗号化バックアップ',
      status: backupFresh ? 'ready' : 'action',
      detail: backupFresh ? `最終保存 ${formatJapanDateTime(user.lastBackupAt)}` : '今すぐ暗号化バックアップを作成してください',
      href: '/security#backup',
    },
    {
      id: 'line_report',
      label: 'LINE受領報告',
      status: telegramReady && workerCapabilities.includes('screenshot') && workerCapabilities.includes('line_contact_detection') ? 'ready' : 'action',
      detail: telegramReady && workerCapabilities.includes('screenshot') && workerCapabilities.includes('line_contact_detection') ? 'LINE ID・URL・QRを検知して会話画面付きで報告できます' : 'ワーカー更新・Telegram接続・スクリーンショット機能が必要です',
      href: '/rules',
    },
    {
      id: 'rules',
      label: '会話運転ルール',
      status: rule.automationMode === 'full_auto' ? 'ready' : 'action',
      detail: rule.automationMode === 'full_auto' ? `許可済み接続では確信度${rule.minimumConfidence}%以上を自動送信します` : 'AI会話ルールで運転レベルを選択してください',
      href: '/rules',
    },
    {
      id: 'operation',
      label: '運転スイッチ',
      status: user.automationState === 'active' ? 'ready' : 'action',
      detail: user.automationState === 'active' ? '自動巡回を許可しています' : '現在は停止中です',
      href: '/?view=settings#operation-title',
    },
    {
      id: 'self_test',
      label: '総合セルフテスト',
      status: selfTestFresh ? 'ready' : 'action',
      detail: selfTestFresh ? 'DB・保管・バックアップ・ワーカー・AIを確認済みです' : '送信なしの安全診断を実行してください',
      href: '/security#self-test',
    },
  ];
  const readyCount = readinessChecks.filter((check) => check.status === 'ready').length;
  const blockingCount = readinessChecks.filter((check) => check.status === 'blocked').length;
  const verificationStages: DashboardPayload['verification']['stages'] = [
    { id: 'connected', label: '実サービスへログイン', verified: connectedServiceCount > 0 },
    { id: 'candidate', label: '候補を取得', verified: contactRows.length > 0 },
    { id: 'liked', label: 'いいねを実送信', verified: contactRows.some((contact) => contact.status === 'liked' || contact.status === 'matched') },
    { id: 'matched', label: 'マッチを検出', verified: contactRows.some((contact) => contact.status === 'matched') || conversationRows.length > 0 },
    { id: 'reply_sent', label: '返信を実送信', verified: messageRows.some((message) => message.direction === 'outgoing' && message.sendState === 'sent') },
    { id: 'line_reported', label: 'LINE受領をTelegram報告', verified: reportRows.some((report) => report.status === 'sent' && report.kind === 'goal_reached' && report.text.includes('LINE')) },
  ];

  const payload: DashboardPayload = {
    user: {
      id: user.id,
      displayName: user.displayName ?? authenticatedUser.displayName,
      email: user.email,
      role: authenticatedUser.role,
      automationState: user.automationState,
      telegramLinked: Boolean(user.telegramChatId),
      telegramMfaEnabled: user.telegramMfaEnabled,
      lastBackupAt: user.lastBackupAt?.toISOString() ?? null,
      lastSelfTestAt: user.lastSelfTestAt?.toISOString() ?? null,
    },
    metrics: {
      liked: contactRows.filter((contact) => contact.status === 'liked').length,
      matched: contactRows.filter((contact) => contact.status === 'matched').length,
      activeConversations: conversationRows.filter((conversation) => conversation.status === 'active').length,
      goalReached: conversationRows.filter((conversation) => conversation.status === 'goal_reached').length,
      needsReview: conversationRows.filter((conversation) => conversation.status === 'escalated').length,
    },
    connections: connectionRows.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      label: connection.label,
      status: connection.status,
      lastHeartbeatAt: connection.lastHeartbeatAt?.toISOString() ?? null,
    })),
    conversations: conversationRows.map((conversation) => ({
      id: conversation.id,
      contactId: conversation.contactId,
      initials: makeInitials(conversation.contactName),
      name: conversation.contactName,
      age: conversation.contactAge,
      provider: conversation.provider,
      providerLabel: conversation.providerLabel,
      location: conversation.contactLocation,
      profileUrl: conversation.profileUrl,
      status: conversation.status,
      automationMode: conversation.automationMode,
      stage: conversation.stage,
      summary: conversation.summary,
      confidence: conversation.confidence,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      messages: (messagesByConversation.get(conversation.id) ?? []).map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        sendState: message.sendState,
        createdAt: message.createdAt.toISOString(),
      })),
    })),
    candidates: contactRows
      .filter((contact) => contact.status === 'candidate' || contact.status === 'liked')
      .map((contact) => ({
        id: contact.id,
        initials: makeInitials(contact.displayName),
        name: contact.displayName,
        age: contact.age,
        provider: contact.provider,
        location: contact.location,
        profileUrl: contact.profileUrl,
        score: contact.score,
        status: contact.status,
      })),
    rule: {
      minAge: 30,
      maxAge: 70,
      radiusKm: rule.radiusKm,
      topics: parseStringArray(rule.topicsJson),
      blockedTopics: parseStringArray(rule.blockedTopicsJson),
      minimumConfidence: rule.minimumConfidence,
      automationMode: rule.automationMode,
      requireApprovalForScheduling: successCondition.requireApprovalForScheduling !== false,
      requireApprovalForContactExchange: false,
      contactExchangeDirection: 'receive_only',
      requiredConversationFields: ['marriage_intent', 'line_contact'],
      goalKeywords: [
        '相手が婚活意思を明示した',
        '相手からLINEを受領した',
      ],
      goalTarget: clampGoalTarget(successCondition.goalTarget),
      preferredLocations: unknownStringArray(successCondition.preferredLocations),
      requiredProfileKeywords: unknownStringArray(successCondition.requiredProfileKeywords),
      excludedProfileKeywords: unknownStringArray(successCondition.excludedProfileKeywords),
      desiredRelationship: '結婚を希望する相手と、真剣な婚活を進める',
      conversationTone: enumValue(successCondition.conversationTone, ['natural', 'friendly', 'calm', 'polite'], 'natural'),
      replyLength: enumValue(successCondition.replyLength, ['short', 'balanced', 'detailed'], 'balanced'),
      questionFrequency: enumValue(successCondition.questionFrequency, ['low', 'balanced', 'high'], 'balanced'),
      persona: stringValue(successCondition.persona, ''),
      forbiddenPhrases: unknownStringArray(successCondition.forbiddenPhrases),
      escalationTriggers: unknownStringArray(successCondition.escalationTriggers),
    },
    worker: {
      status: workerIsFresh ? worker.status : 'offline',
      version: worker?.version ?? null,
      lastSeenAt: worker?.lastSeenAt.toISOString() ?? null,
      capabilities: workerCapabilities,
    },
    readiness: {
      level: readyCount === readinessChecks.length ? 'ready' : blockingCount > 0 ? 'blocked' : 'needs_setup',
      readyCount,
      totalCount: readinessChecks.length,
      checks: readinessChecks,
    },
    verification: {
      completedCount: verificationStages.filter((stage) => stage.verified).length,
      totalCount: verificationStages.length,
      stages: verificationStages,
    },
    reports: reportRows.map((report) => ({
      id: report.id,
      kind: report.kind,
      text: report.text,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    })),
    auditEvents: auditRows.map((event) => ({
      id: event.id,
      type: event.type,
      status: event.status,
      attempts: event.attempts,
      lastError: event.lastError,
      createdAt: event.createdAt.toISOString(),
    })),
  };

  return Response.json(payload, {
    headers: { 'cache-control': 'private, no-store' },
  });
}

function makeInitials(name: string) {
  const characters = Array.from(name.trim());
  return (characters.slice(0, 2).join('') || '—').toUpperCase();
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function formatJapanDateTime(value: Date | null) {
  if (!value) return '未実行';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function unknownStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 10) : [];
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' ? value.slice(0, 1200) : fallback;
}

function enumValue<const T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

function clampGoalTarget(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(100, Math.max(1, value)) : 5;
}
