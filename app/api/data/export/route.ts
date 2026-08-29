import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { aiCredentials, appConnections, automationJobs, automationRules, contacts, conversations, messages, reports, telegramLearningItems, telegramLearningProfiles, users, workerHeartbeats } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getIdentityProfilePayload } from '@/lib/identity-profile';

export async function GET() {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const db = getDb();
  const userId = authenticatedUser.userId;
  const [userRows, connectionRows, ruleRows, contactRows, conversationRows, messageRows, reportRows, learningRows, learningProfileRows, jobRows, workerRows, aiCredentialRows, identity] = await Promise.all([
    db.select({ id: users.id, email: users.email, displayName: users.displayName, automationState: users.automationState, telegramChatId: users.telegramChatId, telegramMfaEnabled: users.telegramMfaEnabled, lastBackupAt: users.lastBackupAt, lastSelfTestAt: users.lastSelfTestAt, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).where(eq(users.id, userId)),
    db.select().from(appConnections).where(eq(appConnections.userId, userId)),
    db.select().from(automationRules).where(eq(automationRules.userId, userId)),
    db.select().from(contacts).where(eq(contacts.userId, userId)),
    db.select().from(conversations).where(eq(conversations.userId, userId)),
    db.select({ id: messages.id, conversationId: messages.conversationId, direction: messages.direction, body: messages.body, sendState: messages.sendState, modelClass: messages.modelClass, externalReference: messages.externalReference, createdAt: messages.createdAt }).from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id)).where(eq(conversations.userId, userId)),
    db.select().from(reports).where(eq(reports.userId, userId)),
    db.select({ id: telegramLearningItems.id, sourceKind: telegramLearningItems.sourceKind, category: telegramLearningItems.category, status: telegramLearningItems.status, redactedText: telegramLearningItems.redactedText, createdAt: telegramLearningItems.createdAt, approvedAt: telegramLearningItems.approvedAt }).from(telegramLearningItems).where(eq(telegramLearningItems.userId, userId)),
    db.select({ conversationGuidance: telegramLearningProfiles.conversationGuidance, reportExample: telegramLearningProfiles.reportExample, ngRulesJson: telegramLearningProfiles.ngRulesJson, summary: telegramLearningProfiles.summary, analyzedCount: telegramLearningProfiles.analyzedCount, model: telegramLearningProfiles.model, updatedAt: telegramLearningProfiles.updatedAt }).from(telegramLearningProfiles).where(eq(telegramLearningProfiles.userId, userId)),
    db.select({ id: automationJobs.id, type: automationJobs.type, status: automationJobs.status, attempts: automationJobs.attempts, lastError: automationJobs.lastError, createdAt: automationJobs.createdAt, updatedAt: automationJobs.updatedAt }).from(automationJobs).where(eq(automationJobs.userId, userId)),
    db.select({ workerId: workerHeartbeats.workerId, status: workerHeartbeats.status, version: workerHeartbeats.version, lastSeenAt: workerHeartbeats.lastSeenAt }).from(workerHeartbeats).where(eq(workerHeartbeats.userId, userId)),
    db.select({ provider: aiCredentials.provider, model: aiCredentials.model, enabled: aiCredentials.enabled, keyHint: aiCredentials.keyHint, updatedAt: aiCredentials.updatedAt }).from(aiCredentials).where(eq(aiCredentials.userId, userId)),
    getIdentityProfilePayload(userId, authenticatedUser),
  ]);
  const exportedAt = new Date();
  await db.insert(automationJobs).values({
    id: `export_${crypto.randomUUID()}`,
    userId,
    connectionId: null,
    type: 'data_export',
    payloadJson: '{}',
    status: 'completed',
    priority: 0,
    attempts: 1,
    runAfter: exportedAt,
    createdAt: exportedAt,
    updatedAt: exportedAt,
  });

  return Response.json({
    format: 'matchpilot-personal-data-v1',
    exportedAt: exportedAt.toISOString(),
    user: userRows[0] ?? null,
    registrationIdentity: {
      profile: identity.profile,
      profilePhotos: identity.photos.map((photo) => ({
        id: photo.id,
        contentType: photo.contentType,
        sizeBytes: photo.sizeBytes,
        category: photo.category,
        position: photo.position,
        isPrimary: photo.isPrimary,
        caption: photo.caption,
        createdAt: photo.createdAt,
        updatedAt: photo.updatedAt,
        image: '[暗号化画像のためJSONエクスポート対象外]',
      })),
      documents: identity.documents.map((document) => ({
        id: document.id,
        kind: document.kind,
        side: document.side,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        expiresOn: document.expiresOn,
        expired: document.expired,
        createdAt: document.createdAt,
      })),
      serviceCredentials: identity.credentials.map((credential) => ({
        id: credential.id,
        serviceKey: credential.serviceKey,
        serviceLabel: credential.serviceLabel,
        loginHint: credential.loginHint,
        registrationFillEnabled: credential.registrationFillEnabled,
        passwordUpdatedAt: credential.passwordUpdatedAt,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
        password: '[暗号化保管のためエクスポート対象外]',
      })),
      gmail: {
        connected: identity.gmail.connected,
        email: identity.gmail.email,
        status: identity.gmail.status,
        lastSyncedAt: identity.gmail.lastSyncedAt,
      },
    },
    connections: connectionRows,
    rules: ruleRows,
    contacts: contactRows,
    conversations: conversationRows,
    messages: messageRows,
    reports: reportRows,
    telegramReportLearning: learningRows,
    telegramLearningProfile: learningProfileRows[0] ?? null,
    automationAudit: jobRows,
    workers: workerRows,
    aiProvider: aiCredentialRows[0] ? { ...aiCredentialRows[0], apiKey: '[暗号化保管のためエクスポート対象外]' } : null,
  }, {
    headers: {
      'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="matchpilot-export-${exportedAt.toISOString().slice(0, 10)}.json"`,
    },
  });
}
