import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import {
  acquiredContactKeys,
  appConnections,
  automationJobs,
  automationRules,
  contacts,
  conversations,
  identityProfiles,
  messages,
  users,
} from '@/db/schema';
import { acquiredNameAgeHash, sameAcquiredNameAge } from '@/lib/automation/acquired-contact';
import { getConnectorDefinition } from '@/lib/automation/connectors';
import { outgoingReplySafetyViolation } from '@/lib/automation/outgoing-language-policy.mjs';
import { SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER } from '@/lib/automation/operational-safety';
import type { AutomationMode } from '@/lib/automation/types';
import { and, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import { validateJsonMutation } from '@/lib/request-security';
import { normalizeUnicodeText, truncateUnicode } from '@/lib/unicode-text';

const DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER = SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER;

type ActionBody = {
  action?: string;
  conversationId?: string;
  messageId?: string;
  contactId?: string;
  body?: string;
  provider?: string;
  providers?: string[];
  connectionIntent?: 'existing' | 'new';
  minimumConfidence?: number;
  automationMode?: AutomationMode;
  minAge?: number | null;
  maxAge?: number | null;
  radiusKm?: number | null;
  topics?: string[];
  blockedTopics?: string[];
  requireApprovalForScheduling?: boolean;
  requireApprovalForContactExchange?: boolean;
  goalKeywords?: string[];
  goalTarget?: number;
  preferredLocations?: string[];
  requiredProfileKeywords?: string[];
  excludedProfileKeywords?: string[];
  desiredRelationship?: string;
  conversationTone?: 'natural' | 'friendly' | 'calm' | 'polite';
  replyLength?: 'short' | 'balanced' | 'detailed';
  questionFrequency?: 'low' | 'balanced' | 'high';
  persona?: string;
  forbiddenPhrases?: string[];
  escalationTriggers?: string[];
};

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) {
    return Response.json({ error: 'authentication_required' }, { status: 401 });
  }

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();

  switch (body.action) {
    case 'conversation.pause':
    case 'conversation.resume': {
      if (!body.conversationId) return invalid('missing_conversation_id');
      const nextStatus = body.action === 'conversation.pause' ? 'paused' : 'active';
      const updated = await db
        .update(conversations)
        .set({ status: nextStatus, updatedAt: now })
        .where(and(eq(conversations.id, body.conversationId), eq(conversations.userId, authenticatedUser.userId)))
        .returning({ id: conversations.id, connectionId: conversations.connectionId });
      if (!updated[0]) return Response.json({ error: 'conversation_not_found' }, { status: 404 });
      await db.insert(automationJobs).values({
        id: `conversation_${crypto.randomUUID()}`,
        userId: authenticatedUser.userId,
        connectionId: updated[0].connectionId,
        type: nextStatus === 'paused' ? 'pause_conversation' : 'resume_conversation',
        payloadJson: JSON.stringify({ conversationId: updated[0].id }),
        status: 'pending',
        priority: 20,
        runAfter: now,
        createdAt: now,
        updatedAt: now,
      });
      return Response.json({ ok: true, status: nextStatus });
    }

    case 'message.queue': {
      if (!body.conversationId) return invalid('missing_conversation_id');
      const messageBody = normalizeText(body.body, 2000);
      if (!messageBody) return invalid('invalid_message');
      const safetyViolation = outgoingReplySafetyViolation(messageBody);
      if (safetyViolation) return Response.json({ error: 'unsafe_outgoing_message', reason: safetyViolation }, { status: 409 });
      const ownedConversation = await db
        .select({ id: conversations.id, connectionId: conversations.connectionId, status: conversations.status, threadUrl: conversations.threadUrl, externalReference: conversations.externalReference, provider: appConnections.provider })
        .from(conversations)
        .innerJoin(appConnections, eq(conversations.connectionId, appConnections.id))
        .where(and(eq(conversations.id, body.conversationId), eq(conversations.userId, authenticatedUser.userId)))
        .limit(1);
      if (!ownedConversation[0]) return Response.json({ error: 'conversation_not_found' }, { status: 404 });
      if (ownedConversation[0].status === 'closed') return Response.json({ error: 'conversation_closed' }, { status: 409 });
      const recentOutgoing = await db
        .select({ body: messages.body })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(and(
          eq(conversations.userId, authenticatedUser.userId),
          eq(messages.direction, 'outgoing'),
          inArray(messages.sendState, ['draft', 'queued', 'sent']),
        ))
        .orderBy(desc(messages.createdAt))
        .limit(24);
      const duplicateViolation = outgoingReplySafetyViolation(messageBody, recentOutgoing.map((message) => message.body));
      if (duplicateViolation) return Response.json({ error: 'unsafe_outgoing_message', reason: duplicateViolation }, { status: 409 });

      const messageId = `message_${crypto.randomUUID()}`;
      await db.batch([
        db.insert(messages).values({
          id: messageId,
          conversationId: ownedConversation[0].id,
          direction: 'outgoing',
          body: messageBody,
          sendState: 'queued',
          modelClass: 'human_approved',
          createdAt: now,
        }),
        db.insert(automationJobs).values({
          id: `send_${messageId}`,
          userId: authenticatedUser.userId,
          connectionId: ownedConversation[0].connectionId,
          type: 'send_message',
          payloadJson: JSON.stringify({ conversationId: ownedConversation[0].id, conversationExternalReference: ownedConversation[0].externalReference, threadUrl: ownedConversation[0].threadUrl, provider: ownedConversation[0].provider, messageId, body: messageBody }),
          status: 'pending',
          priority: 10,
          runAfter: now,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      return Response.json({ ok: true, messageId }, { status: 201 });
    }

    case 'message.cancel': {
      if (!body.messageId) return invalid('missing_message_id');
      const ownedMessage = await db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(and(eq(messages.id, body.messageId), eq(conversations.userId, authenticatedUser.userId), eq(messages.sendState, 'queued')))
        .limit(1);
      if (!ownedMessage[0]) return Response.json({ error: 'message_not_cancellable' }, { status: 409 });
      await db.batch([
        db.update(messages).set({ sendState: 'cancelled' }).where(eq(messages.id, body.messageId)),
        db.update(automationJobs).set({ status: 'cancelled', updatedAt: now }).where(and(eq(automationJobs.id, `send_${body.messageId}`), eq(automationJobs.status, 'pending'))),
      ]);
      return Response.json({ ok: true });
    }

    case 'candidate.like':
    case 'candidate.archive': {
      if (!body.contactId) return invalid('missing_contact_id');
      const nextStatus = body.action === 'candidate.like' ? 'liked' : 'archived';
      const candidate = await db
        .select({ id: contacts.id, provider: contacts.provider, externalReference: contacts.externalReference, profileUrl: contacts.profileUrl, displayName: contacts.displayName, age: contacts.age })
        .from(contacts)
        .where(and(eq(contacts.id, body.contactId), eq(contacts.userId, authenticatedUser.userId), eq(contacts.status, 'candidate')))
        .limit(1);
      if (!candidate[0]) return Response.json({ error: 'candidate_not_available' }, { status: 409 });

      if (nextStatus === 'liked') {
        if (await isAcquiredCandidate(authenticatedUser.userId, candidate[0])) {
          await db.update(contacts).set({ status: 'blocked' }).where(eq(contacts.id, candidate[0].id));
          return Response.json({ error: 'previously_acquired_contact' }, { status: 409 });
        }
        const connection = await db
          .select({ id: appConnections.id })
          .from(appConnections)
          .where(and(eq(appConnections.userId, authenticatedUser.userId), eq(appConnections.provider, candidate[0].provider)))
          .limit(1);
        if (!connection[0]) return Response.json({ error: 'connection_not_found' }, { status: 409 });
        const todaysLikeJobs = await db
          .select({ id: automationJobs.id })
          .from(automationJobs)
          .where(and(
            eq(automationJobs.userId, authenticatedUser.userId),
            eq(automationJobs.connectionId, connection[0].id),
            eq(automationJobs.type, 'like_contact'),
            gte(automationJobs.createdAt, startOfCurrentJapanDay(now)),
            ne(automationJobs.status, 'cancelled'),
          ));
        if (todaysLikeJobs.length >= DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER) {
          return Response.json({ error: 'daily_new_contact_limit_reached', limit: DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER }, { status: 429 });
        }

        await db.batch([
          db.update(contacts).set({ status: 'liked' }).where(and(eq(contacts.id, candidate[0].id), eq(contacts.status, 'candidate'))),
          db.insert(automationJobs).values({
            id: `like_${crypto.randomUUID()}`,
            userId: authenticatedUser.userId,
            connectionId: connection[0].id,
            type: 'like_contact',
            payloadJson: JSON.stringify({ contactId: candidate[0].id, contactExternalReference: candidate[0].externalReference, profileUrl: candidate[0].profileUrl, provider: candidate[0].provider }),
            status: 'pending',
            priority: 50,
            runAfter: now,
            createdAt: now,
            updatedAt: now,
          }),
        ]);
        return Response.json({ ok: true, status: nextStatus, dailyLimit: DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER });
      }

      const updated = await db
        .update(contacts)
        .set({ status: nextStatus })
        .where(and(eq(contacts.id, body.contactId), eq(contacts.userId, authenticatedUser.userId), eq(contacts.status, 'candidate')))
        .returning({ id: contacts.id, provider: contacts.provider, externalReference: contacts.externalReference, profileUrl: contacts.profileUrl });
      if (!updated[0]) return Response.json({ error: 'candidate_not_available' }, { status: 409 });
      return Response.json({ ok: true, status: nextStatus });
    }

    case 'rule.save': {
      const minimumConfidence = clampInteger(body.minimumConfidence, 70, 99);
      const minAge = 30;
      const maxAge = 70;
      const radiusKm = nullableInteger(body.radiusKm, 1, 500);
      const automationMode = body.automationMode;
      if (minimumConfidence === null || !automationMode || !['full_auto', 'approval', 'draft_only'].includes(automationMode)) {
        return invalid('invalid_rule');
      }
      if (minAge !== null && maxAge !== null && minAge > maxAge) return invalid('invalid_age_range');
      const topics = normalizeStringArray(body.topics, 20, 40);
      const blockedTopics = normalizeStringArray(body.blockedTopics, 20, 40);
      const goalKeywords = [
        '相手が婚活意思を明示した',
        '相手からLINEを受領した',
      ];
      const goalTarget = clampInteger(body.goalTarget, 1, 100);
      if (goalTarget === null) return invalid('invalid_goal_target');
      const preferredLocations = normalizeStringArray(body.preferredLocations, 20, 40);
      const requiredProfileKeywords = normalizeStringArray(body.requiredProfileKeywords, 20, 40);
      const excludedProfileKeywords = normalizeStringArray(body.excludedProfileKeywords, 20, 40);
      const requestedRelationship = normalizeText(body.desiredRelationship, 120);
      const desiredRelationship = /(婚活|結婚)/u.test(requestedRelationship)
        ? requestedRelationship
        : '結婚を希望する相手と、真剣な婚活を進める';
      const conversationTone = ['natural', 'friendly', 'calm', 'polite'].includes(body.conversationTone ?? '') ? body.conversationTone : 'natural';
      const replyLength = ['short', 'balanced', 'detailed'].includes(body.replyLength ?? '') ? body.replyLength : 'balanced';
      const questionFrequency = ['low', 'balanced', 'high'].includes(body.questionFrequency ?? '') ? body.questionFrequency : 'balanced';
      const persona = normalizeText(body.persona, 1200);
      const forbiddenPhrases = normalizeStringArray(body.forbiddenPhrases, 30, 80);
      const escalationTriggers = normalizeStringArray(body.escalationTriggers, 30, 80);
      const successCondition = {
        requireApprovalForScheduling: body.requireApprovalForScheduling !== false,
        requireApprovalForContactExchange: false,
        contactExchangeDirection: 'receive_only',
        requiredConversationFields: ['marriage_intent', 'line_contact'],
        goalKeywords,
        goalTarget,
        preferredLocations,
        requiredProfileKeywords,
        excludedProfileKeywords,
        desiredRelationship,
        conversationTone,
        replyLength,
        questionFrequency,
        persona,
        forbiddenPhrases,
        escalationTriggers,
      };
      await db
        .insert(automationRules)
        .values({
          id: `rule_${authenticatedUser.userId}`,
          userId: authenticatedUser.userId,
          name: '既定の自動化ルール',
          minAge,
          maxAge,
          radiusKm,
          topicsJson: JSON.stringify(topics),
          blockedTopicsJson: JSON.stringify(blockedTopics),
          minimumConfidence,
          automationMode,
          successConditionJson: JSON.stringify(successCondition),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: automationRules.id,
          set: {
            minAge,
            maxAge,
            radiusKm,
            topicsJson: JSON.stringify(topics),
            blockedTopicsJson: JSON.stringify(blockedTopics),
            minimumConfidence,
            automationMode,
            successConditionJson: JSON.stringify(successCondition),
            updatedAt: now,
          },
        });
      await db.insert(automationJobs).values({
        id: `rules_${crypto.randomUUID()}`,
        userId: authenticatedUser.userId,
        connectionId: null,
        type: 'sync_rules',
        payloadJson: JSON.stringify({ minimumConfidence, automationMode, minAge, maxAge, radiusKm, topics, blockedTopics, ...successCondition }),
        status: 'pending',
        priority: 30,
        runAfter: now,
        createdAt: now,
        updatedAt: now,
      });
      return Response.json({ ok: true });
    }

    case 'connection.add':
    case 'connection.addMany': {
      const requestedProviders = body.action === 'connection.addMany'
        ? normalizeStringArray(body.providers, 32, 40)
        : body.provider ? [body.provider] : [];
      if (requestedProviders.length === 0) return invalid('missing_provider');
      const connectors = requestedProviders.map(getConnectorDefinition);
      if (connectors.some((connector) => !connector || connector.supportStatus !== 'assisted')) {
        return invalid('unsupported_provider');
      }
      const intent = body.connectionIntent === 'new' ? 'new' : 'existing';
      const identityRows = intent === 'new'
        ? await db.select({ enabled: identityProfiles.registrationAssistEnabled }).from(identityProfiles).where(eq(identityProfiles.userId, authenticatedUser.userId)).limit(1)
        : [];
      const useIdentityProfile = identityRows[0]?.enabled === true;
      const existingConnections = intent === 'new'
        ? await db
            .select({ provider: appConnections.provider })
            .from(appConnections)
            .where(and(
              eq(appConnections.userId, authenticatedUser.userId),
              inArray(appConnections.provider, requestedProviders),
            ))
        : [];
      const existingProviders = new Set(existingConnections.map((connection) => connection.provider));
      const skippedProviders: string[] = [];
      const connectionIds: string[] = [];
      for (const connector of connectors) {
        if (!connector) continue;
        if (intent === 'new' && existingProviders.has(connector.id)) {
          skippedProviders.push(connector.id);
          continue;
        }
        const inserted = await db
          .insert(appConnections)
          .values({
            id: `connection_${crypto.randomUUID()}`,
            userId: authenticatedUser.userId,
            provider: connector.id,
            label: connector.label,
            status: 'needs_verification',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [appConnections.userId, appConnections.provider],
            set: { label: connector.label, status: 'needs_verification', updatedAt: now },
          })
          .returning({ id: appConnections.id });
        const connectionId = inserted[0]?.id;
        if (!connectionId) return Response.json({ error: 'connection_save_failed' }, { status: 500 });
        connectionIds.push(connectionId);
        await db.insert(automationJobs).values({
          id: `connect_${crypto.randomUUID()}`,
          userId: authenticatedUser.userId,
          connectionId,
          type: 'start_session',
          payloadJson: JSON.stringify({
            provider: connector.id,
            entryUrl: intent === 'new' ? connector.signupUrl : connector.entryUrl,
            intent,
            setupMode: useIdentityProfile ? 'profile_assisted' : 'manual_handoff',
            useIdentityProfile,
            registrationMethods: connector.registrationMethods,
            minimumSetupFields: connector.minimumSetupFields,
          }),
          status: 'pending',
          priority: 0,
          runAfter: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (connectionIds.length === 0 && skippedProviders.length > 0) {
        return Response.json({ error: 'account_already_registered', skippedProviders }, { status: 409 });
      }
      return Response.json({
        ok: true,
        connectionIds,
        intent,
        operation: 'registration_preparation',
        accountsCreated: 0,
        skippedProviders,
        requiresFinalUserAction: intent === 'new',
      }, { status: 201 });
    }

    case 'telegram.unlink': {
      const security = await db.select({ mfaEnabled: users.telegramMfaEnabled }).from(users).where(eq(users.id, authenticatedUser.userId)).limit(1);
      if (security[0]?.mfaEnabled) return Response.json({ error: 'disable_mfa_first' }, { status: 409 });
      await db.update(users).set({ telegramChatId: null, telegramMfaEnabled: false, updatedAt: now }).where(eq(users.id, authenticatedUser.userId));
      return Response.json({ ok: true });
    }

    default:
      return invalid('unsupported_action');
  }
}

async function isAcquiredCandidate(userId: string, candidate: { displayName: string; age: number | null }) {
  const db = getDb();
  const key = await acquiredNameAgeHash(candidate);
  if (key) {
    const indexed = await db.select({ id: acquiredContactKeys.id }).from(acquiredContactKeys).where(and(
      eq(acquiredContactKeys.userId, userId),
      eq(acquiredContactKeys.keyKind, 'name_age'),
      eq(acquiredContactKeys.keyHash, key),
    )).limit(1);
    if (indexed[0]) return true;
  }
  const historic = await db
    .select({ displayName: contacts.displayName, age: contacts.age })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(and(eq(conversations.userId, userId), eq(conversations.status, 'goal_reached')))
    .limit(5000);
  return historic.some((contact) => sameAcquiredNameAge(candidate, contact));
}

function invalid(error: string) {
  return Response.json({ error }, { status: 400 });
}

function normalizeText(value: unknown, maximumLength: number) {
  return normalizeUnicodeText(value, maximumLength);
}

function normalizeStringArray(value: unknown, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => truncateUnicode(item.trim().normalize('NFKC'), maximumLength))
    .filter(Boolean)))
    .slice(0, maximumItems);
}

function clampInteger(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return Math.min(maximum, Math.max(minimum, value));
}

function nullableInteger(value: unknown, minimum: number, maximum: number) {
  if (value === null || typeof value === 'undefined') return null;
  return clampInteger(value, minimum, maximum);
}

function startOfCurrentJapanDay(now: Date) {
  const japanOffsetMs = 9 * 60 * 60 * 1000;
  const japanNow = new Date(now.getTime() + japanOffsetMs);
  return new Date(Date.UTC(japanNow.getUTCFullYear(), japanNow.getUTCMonth(), japanNow.getUTCDate()) - japanOffsetMs);
}
