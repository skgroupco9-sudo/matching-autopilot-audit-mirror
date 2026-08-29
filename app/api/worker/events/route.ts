import { getDb, getFilesBucket } from '@/db';
import {
  appConnections,
  acquiredContactKeys,
  automationJobs,
  automationRules,
  contacts,
  conversations,
  messages,
  reports,
  users,
  workerHeartbeats,
} from '@/db/schema';
import type { WorkerEvent } from '@/lib/automation/types';
import { acquiredLineHash, acquiredNameAgeHash, sameAcquiredNameAge } from '@/lib/automation/acquired-contact';
import { hasRecentDuplicateOutgoingMessage, REPEATED_OUTGOING_WINDOW_MS } from '@/lib/automation/account-safety';
import { planLineBlock } from '@/lib/automation/line-block-window.mjs';
import { assessReply } from '@/lib/automation/policy';
import { assessMarriageCandidate, extractMarriageProfileFacts } from '@/lib/automation/marriage-policy';
import { SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER } from '@/lib/automation/operational-safety';
import { planAutomatedReply, replyHoldReason } from '@/lib/automation/reply-throttle';
import { enrichIncomingContactEvent, formatAutomationReport } from '@/lib/automation/telegram-report';
import { sendTelegramReport } from '@/lib/telegram';
import { applyTelegramReportLearning, getTelegramConversationLearning } from '@/lib/telegram-learning';
import { authorizeWorkerRequest } from '@/lib/worker-auth';
import { and, desc, eq, gte, inArray, ne } from 'drizzle-orm';

const DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER = SAFE_DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER;

const acceptedEventTypes = new Set<WorkerEvent['type']>([
  'incoming_message',
  'outgoing_message',
  'candidate_discovered',
  'match_created',
  'session_ready',
  'registration_profile_prepared',
  'verification_code_prepared',
  'goal_reached',
  'checkpoint_required',
  'block_completed',
  'block_failed',
  'worker_error',
]);

type EventOutcome = {
  conversationId?: string;
  draftMessageId?: string;
  replyAction?: 'send' | 'request_approval' | 'block';
  duplicateAcquired?: boolean;
};

export async function POST(request: Request) {
  const worker = await authorizeWorkerRequest(request);
  if (!worker) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let event: WorkerEvent;
  try {
    event = (await request.json()) as WorkerEvent;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (
    !event.id ||
    !/^[a-zA-Z0-9_-]{1,40}$/.test(event.id) ||
    !event.userId ||
    !event.connectionId ||
    !acceptedEventTypes.has(event.type) ||
    !event.payload ||
    !isIsoDate(event.occurredAt)
  ) {
    return Response.json({ error: 'invalid_event' }, { status: 400 });
  }
  if (event.userId !== worker.userId) {
    return Response.json({ error: 'worker_binding_mismatch' }, { status: 403 });
  }

  event = enrichIncomingContactEvent(event);

  const db = getDb();
  const activeWorker = await db
    .select({ id: workerHeartbeats.workerId })
    .from(workerHeartbeats)
    .where(and(
      eq(workerHeartbeats.workerId, worker.workerId),
      eq(workerHeartbeats.userId, worker.userId),
      gte(workerHeartbeats.lastSeenAt, new Date(Date.now() - 120_000)),
    ))
    .limit(1);
  if (!activeWorker[0]) {
    return Response.json({ error: 'fresh_heartbeat_required' }, { status: 409 });
  }
  const connection = await db
    .select({ id: appConnections.id, provider: appConnections.provider })
    .from(appConnections)
    .where(and(eq(appConnections.id, event.connectionId), eq(appConnections.userId, event.userId)))
    .limit(1);
  if (!connection[0]) {
    return Response.json({ error: 'connection_not_owned_by_user' }, { status: 403 });
  }

  const eventKey = await stableKey(`${event.userId}:${event.id}`);
  const receiptId = `event_${eventKey}`;
  const existingReceipt = await db
    .select({ id: automationJobs.id })
    .from(automationJobs)
    .where(and(eq(automationJobs.id, receiptId), eq(automationJobs.status, 'completed')))
    .limit(1);
  if (existingReceipt[0]) {
    return Response.json({ ok: true, duplicate: true });
  }

  const now = new Date();
  let outcome: EventOutcome = {};
  try {
    outcome = await persistEventState(event, connection[0].provider, eventKey, now);
    const receivedContact = objectField(event.payload.contactExchange);
    if (event.type === 'incoming_message' && receivedContact.detected === true && outcome.conversationId) {
      const blockPlan = await ensureLineBlockJob(event, outcome.conversationId, connection[0].provider, now);
      event = {
        ...event,
        payload: {
          ...event.payload,
          blockNotBefore: blockPlan.notBefore.toISOString(),
          blockDeadline: blockPlan.deadline.toISOString(),
        },
      };
    }
    if (event.type === 'checkpoint_required') {
      await ensureApprovalJob(event, now);
    } else if (outcome.replyAction === 'request_approval') {
      await ensureApprovalJob({ ...event, conversationId: outcome.conversationId, payload: { ...event.payload, messageId: outcome.draftMessageId } }, now);
    }
    await db
      .insert(automationJobs)
      .values({
        id: receiptId,
        userId: event.userId,
        connectionId: event.connectionId,
        type: 'event_receipt',
        payloadJson: JSON.stringify({ type: event.type, occurredAt: event.occurredAt }),
        status: 'completed',
        priority: 999,
        runAfter: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: automationJobs.id,
        set: { status: 'completed', lastError: null, updatedAt: now },
      });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'event_processing_failed';
    return Response.json({ error: 'event_processing_failed', detail: message }, { status: 500 });
  }

  const receivedContact = objectField(event.payload.contactExchange);
  const receivedLineKey = await acquiredLineHash({
    lineId: stringField(receivedContact.lineId),
    lineUrl: safeHttpUrl(receivedContact.lineUrl),
  });
  const duplicateLine = receivedLineKey
    ? Boolean((await db.select({ id: acquiredContactKeys.id }).from(acquiredContactKeys).where(and(
        eq(acquiredContactKeys.userId, event.userId),
        eq(acquiredContactKeys.keyKind, 'line'),
        eq(acquiredContactKeys.keyHash, receivedLineKey),
      )).limit(1))[0])
    : false;
  const generatedGoalReached = event.type === 'incoming_message'
    && event.payload.goalReached === true
    && event.payload.marriageIntentStatus === 'confirmed'
    && receivedContact.detected === true
    && !duplicateLine
    && Boolean(outcome.conversationId);
  if (generatedGoalReached && outcome.conversationId) {
    await db
      .update(conversations)
      .set({ status: 'goal_reached', updatedAt: now })
      .where(and(eq(conversations.id, outcome.conversationId), eq(conversations.userId, event.userId)));
    await recordAcquiredContact(event, outcome.conversationId, receivedLineKey, now);
    await deliverTelegramReport({
      ...event,
      type: 'goal_reached',
      conversationId: outcome.conversationId,
      payload: { ...event.payload, approvalAllowed: outcome.replyAction === 'request_approval' },
    }, now);
  } else if ((duplicateLine || outcome.duplicateAcquired) && event.type !== 'candidate_discovered') {
    if (outcome.conversationId) {
      await db.update(conversations).set({ status: 'closed', updatedAt: now }).where(and(eq(conversations.id, outcome.conversationId), eq(conversations.userId, event.userId)));
    }
    await deliverTelegramReport({
      ...event,
      type: 'checkpoint_required',
      conversationId: outcome.conversationId,
      payload: { ...event.payload, goalReached: false, summary: '過去に獲得済みの相手を検出したため、いいね・マッチ・会話を停止しました。', approvalAllowed: false },
    }, now);
  } else if (event.type === 'goal_reached' || event.type === 'checkpoint_required') {
    await deliverTelegramReport(event, now);
  } else if (event.type === 'block_completed' || event.type === 'block_failed') {
    await deliverTelegramReport(event, now);
  } else if (
    event.type === 'incoming_message'
    && receivedContact.detected === true
    && Boolean(stringField(event.payload.suggestedReply))
    && outcome.conversationId
  ) {
    await db.update(conversations).set({ status: 'closed', updatedAt: now }).where(and(eq(conversations.id, outcome.conversationId), eq(conversations.userId, event.userId)));
    await deliverTelegramReport({
      ...event,
      type: 'checkpoint_required',
      conversationId: outcome.conversationId,
      payload: {
        ...event.payload,
        goalReached: false,
        summary: 'LINEを受領したためアプリ内返信を終了しました。婚活意思の確認が完了していないため、達成報告ではなく確認事項として記録します。',
        approvalAllowed: false,
      },
    }, now);
  } else if (event.type === 'incoming_message' && outcome.replyAction && outcome.replyAction !== 'send') {
    await deliverTelegramReport({
      ...event,
      type: 'checkpoint_required',
      conversationId: outcome.conversationId,
      payload: { ...event.payload, approvalAllowed: outcome.replyAction === 'request_approval' },
    }, now);
  }

  return Response.json({ ok: true, acceptedAt: now.toISOString() }, { status: 202 });
}

async function persistEventState(event: WorkerEvent, provider: string, eventKey: string, now: Date): Promise<EventOutcome> {
  const db = getDb();
  await db
    .update(appConnections)
    .set({
      status: event.type === 'worker_error' ? 'error' : event.type === 'checkpoint_required' || event.type === 'block_failed' ? 'needs_verification' : 'connected',
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(and(eq(appConnections.id, event.connectionId), eq(appConnections.userId, event.userId)));

  if (event.type === 'worker_error' || event.type === 'session_ready' || event.type === 'registration_profile_prepared' || event.type === 'verification_code_prepared') return {};

  if (event.type === 'block_completed' || event.type === 'block_failed') {
    if (!event.conversationId) throw new Error('block_event_conversation_required');
    const owned = await db.select({ contactId: conversations.contactId })
      .from(conversations)
      .where(and(eq(conversations.id, event.conversationId), eq(conversations.userId, event.userId), eq(conversations.connectionId, event.connectionId)))
      .limit(1);
    if (!owned[0]) throw new Error('block_event_conversation_not_owned');
    await db.batch([
      db.update(conversations).set({ status: event.type === 'block_completed' ? 'closed' : 'escalated', updatedAt: now }).where(eq(conversations.id, event.conversationId)),
      ...(event.type === 'block_completed'
        ? [db.update(contacts).set({ status: 'blocked' }).where(and(eq(contacts.id, owned[0].contactId), eq(contacts.userId, event.userId)))]
        : []),
    ]);
    return { conversationId: event.conversationId };
  }

  if (event.type === 'outgoing_message') {
    const messageId = stringField(event.payload.messageId);
    if (messageId) {
      const ownedMessage = await db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(and(eq(messages.id, messageId), eq(conversations.userId, event.userId), eq(conversations.connectionId, event.connectionId)))
        .limit(1);
      if (!ownedMessage[0]) throw new Error('outgoing_message_not_owned');
      await db.update(messages).set({
        sendState: 'sent',
        externalReference: stringField(event.payload.externalReference) ?? null,
        createdAt: new Date(event.occurredAt),
      }).where(eq(messages.id, messageId));
    } else if (event.conversationId) {
      await requireOwnedConversation(event.conversationId, event.userId, event.connectionId);
      const body = stringField(event.payload.body);
      if (body) {
        await db.insert(messages).values({
          id: `outgoing_${eventKey}`,
          conversationId: event.conversationId,
          direction: 'outgoing',
          body,
          sendState: 'sent',
          modelClass: stringField(event.payload.modelClass),
          externalReference: stringField(event.payload.externalReference),
          createdAt: new Date(event.occurredAt),
        }).onConflictDoNothing();
      }
    }
    if (event.conversationId) {
      await db.update(conversations).set({ lastMessageAt: new Date(event.occurredAt), updatedAt: now }).where(and(eq(conversations.id, event.conversationId), eq(conversations.userId, event.userId)));
    }
    return {};
  }

  const externalReference = stringField(event.payload.contactExternalReference) ?? stringField(event.payload.contactId);
  const displayName = stringField(event.payload.displayName);
  if (!externalReference || !displayName) {
    if (event.type === 'goal_reached' || event.type === 'checkpoint_required') {
      if (event.conversationId) {
        await db
          .update(conversations)
          .set({ status: event.type === 'goal_reached' ? 'goal_reached' : 'escalated', updatedAt: now })
          .where(and(eq(conversations.id, event.conversationId), eq(conversations.userId, event.userId)));
      }
      return { conversationId: event.conversationId };
    }
    throw new Error('contact_identity_required');
  }

  const existingContact = await db
    .select({ status: contacts.status })
    .from(contacts)
    .where(and(eq(contacts.userId, event.userId), eq(contacts.provider, provider), eq(contacts.externalReference, externalReference)))
    .limit(1);
  const age = integerField(event.payload.age);
  const nameAgeKey = await acquiredNameAgeHash({ displayName, age });
  const contactExchange = objectField(event.payload.contactExchange);
  const lineKey = await acquiredLineHash({
    lineId: stringField(contactExchange.lineId),
    lineUrl: safeHttpUrl(contactExchange.lineUrl),
  });
  const linePreviouslyAcquired = lineKey ? await hasAcquiredKey(event.userId, 'line', lineKey) : false;
  const alreadyAcquired = linePreviouslyAcquired || await isPreviouslyAcquired(event.userId, displayName, age, nameAgeKey, now);
  const candidateRule = event.type === 'candidate_discovered'
    ? (await db.select().from(automationRules).where(eq(automationRules.userId, event.userId)).limit(1))[0]
    : undefined;
  const candidateAssessment = alreadyAcquired
    ? { eligible: false, score: 0, reasons: ['過去に獲得済みの相手です'] }
    : candidateRule ? assessCandidate(event.payload, candidateRule) : { eligible: true, score: 0, reasons: [] };
  const nextContactStatus = event.type === 'candidate_discovered'
    ? existingContact[0] && existingContact[0].status !== 'candidate'
      ? existingContact[0].status
      : candidateAssessment.eligible ? 'candidate' : alreadyAcquired ? 'blocked' : 'archived'
    : 'matched';
  const contactRows = await db
    .insert(contacts)
    .values({
      id: stringField(event.payload.contactId) ?? `contact_${crypto.randomUUID()}`,
      userId: event.userId,
      provider,
      externalReference,
      displayName,
      age: integerField(event.payload.age),
      location: stringField(event.payload.location),
      profileUrl: safeHttpUrl(event.payload.profileUrl),
      screenshotObjectKey: stringField(event.payload.screenshotObjectKey),
      score: event.type === 'candidate_discovered' ? candidateAssessment.score : boundedInteger(event.payload.score, 0, 100) ?? 0,
      status: nextContactStatus,
      createdAt: new Date(event.occurredAt),
    })
    .onConflictDoUpdate({
      target: [contacts.userId, contacts.provider, contacts.externalReference],
      set: {
        displayName,
        age: integerField(event.payload.age),
        location: stringField(event.payload.location),
        profileUrl: safeHttpUrl(event.payload.profileUrl),
        screenshotObjectKey: stringField(event.payload.screenshotObjectKey),
        score: event.type === 'candidate_discovered' ? candidateAssessment.score : boundedInteger(event.payload.score, 0, 100) ?? 0,
        status: nextContactStatus,
      },
    })
    .returning({ id: contacts.id });
  const contactId = contactRows[0]?.id;
  if (!contactId) throw new Error('contact_upsert_failed');
  if (alreadyAcquired) {
    if (event.type !== 'candidate_discovered') {
      await db.update(contacts).set({ status: 'blocked' }).where(eq(contacts.id, contactId));
    }
    return { duplicateAcquired: true };
  }
  if (event.type === 'candidate_discovered') {
    const profileUrl = safeHttpUrl(event.payload.profileUrl);
    if (candidateRule?.automationMode === 'full_auto' && candidateAssessment.eligible && nextContactStatus === 'candidate' && profileUrl) {
      const todaysLikeJobs = await db
        .select({ id: automationJobs.id })
        .from(automationJobs)
        .where(and(
          eq(automationJobs.userId, event.userId),
          eq(automationJobs.connectionId, event.connectionId),
          eq(automationJobs.type, 'like_contact'),
          gte(automationJobs.createdAt, startOfCurrentJapanDay(now)),
          ne(automationJobs.status, 'cancelled'),
        ));
      if (todaysLikeJobs.length < DAILY_NEW_CONTACT_LIMIT_PER_PROVIDER) {
        const likeJobId = `like_auto_${await stableKey(`${event.userId}:${provider}:${externalReference}`)}`;
        await db.batch([
          db.update(contacts).set({ status: 'liked' }).where(and(eq(contacts.id, contactId), eq(contacts.status, 'candidate'))),
          db.insert(automationJobs).values({
            id: likeJobId,
            userId: event.userId,
            connectionId: event.connectionId,
            type: 'like_contact',
            payloadJson: JSON.stringify({ contactId, contactExternalReference: externalReference, profileUrl, provider, source: 'full_auto_rule' }),
            status: 'pending',
            priority: 50,
            runAfter: now,
            createdAt: now,
            updatedAt: now,
          }).onConflictDoNothing(),
        ]);
      }
    }
    return {};
  }

  const conversationId = event.conversationId ?? stringField(event.payload.conversationId) ?? `conversation_${crypto.randomUUID()}`;
  const activeRule = (await db.select().from(automationRules).where(eq(automationRules.userId, event.userId)).limit(1))[0];
  const conversationAutomationMode = automationModeField(event.payload.automationMode) ?? activeRule?.automationMode ?? 'approval';
  const conversationRows = await db
    .insert(conversations)
    .values({
      id: conversationId,
      userId: event.userId,
      connectionId: event.connectionId,
      contactId,
      externalReference: stringField(event.payload.conversationExternalReference),
      threadUrl: safeHttpUrl(event.payload.threadUrl),
      status: event.type === 'goal_reached' ? 'goal_reached' : event.type === 'checkpoint_required' ? 'escalated' : 'active',
      automationMode: conversationAutomationMode,
      stage: stringField(event.payload.stage) ?? 'rapport',
      summary: stringField(event.payload.summary) ?? '',
      confidence: boundedInteger(event.payload.confidence, 0, 100) ?? 0,
      lastMessageAt: new Date(event.occurredAt),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [conversations.connectionId, conversations.contactId],
      set: {
        status: event.type === 'goal_reached' ? 'goal_reached' : event.type === 'checkpoint_required' ? 'escalated' : 'active',
        externalReference: stringField(event.payload.conversationExternalReference),
        threadUrl: safeHttpUrl(event.payload.threadUrl),
        stage: stringField(event.payload.stage) ?? 'rapport',
        summary: stringField(event.payload.summary) ?? '',
        confidence: boundedInteger(event.payload.confidence, 0, 100) ?? 0,
        automationMode: conversationAutomationMode,
        lastMessageAt: new Date(event.occurredAt),
        updatedAt: now,
      },
    })
    .returning({ id: conversations.id });
  const storedConversationId = conversationRows[0]?.id ?? conversationId;

  if (event.type === 'incoming_message') {
    const body = stringField(event.payload.body);
    if (!body) throw new Error('incoming_message_body_required');
    await db.insert(messages).values({
      id: stringField(event.payload.messageId) ?? `incoming_${event.id}`,
      conversationId: storedConversationId,
      direction: 'incoming',
      body,
      sendState: 'received',
      externalReference: stringField(event.payload.externalReference) ?? event.id,
      createdAt: new Date(event.occurredAt),
    }).onConflictDoNothing();

    const suggestedReply = stringField(event.payload.suggestedReply);
    if (!suggestedReply) {
      const ruleRows = await db.select().from(automationRules).where(eq(automationRules.userId, event.userId)).limit(1);
      const successCondition = ruleRows[0] ? parseObject(ruleRows[0].successConditionJson) : {};
      const [recentMessages, styleExamples, recentOutgoingForDiversity, telegramLearning] = await Promise.all([
        db
          .select({ direction: messages.direction, body: messages.body })
          .from(messages)
          .where(and(
            eq(messages.conversationId, storedConversationId),
            inArray(messages.sendState, ['received', 'sent']),
          ))
          .orderBy(desc(messages.createdAt))
          .limit(12),
        db
          .select({ body: messages.body })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .where(and(
            eq(conversations.userId, event.userId),
            eq(messages.direction, 'outgoing'),
            eq(messages.sendState, 'sent'),
            eq(messages.modelClass, 'human_approved'),
          ))
          .orderBy(desc(messages.createdAt))
          .limit(6),
        db
          .select({ body: messages.body })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .where(and(
            eq(conversations.userId, event.userId),
            eq(messages.direction, 'outgoing'),
            eq(messages.sendState, 'sent'),
          ))
          .orderBy(desc(messages.createdAt))
          .limit(24),
        getTelegramConversationLearning(event.userId),
      ]);
      await db.insert(automationJobs).values({
        id: `generate_${eventKey}`,
        userId: event.userId,
        connectionId: event.connectionId,
        type: 'generate_reply',
        payloadJson: JSON.stringify({
          sourceEventId: event.id,
          conversationId: storedConversationId,
          provider,
          threadUrl: safeHttpUrl(event.payload.threadUrl),
          messageId: stringField(event.payload.messageId) ?? `incoming_${event.id}`,
          incomingBody: body,
          lineReceivedAt: event.occurredAt,
          conversation: recentMessages.reverse(),
          styleExamples: [...telegramLearning.examples, ...styleExamples.map((example) => example.body)].slice(0, 6),
          avoidExamples: recentOutgoingForDiversity.map((example) => example.body),
          sourceReliability: stringField(event.payload.sourceReliability),
          automationMode: ruleRows[0]?.automationMode ?? 'approval',
          contact: {
            contactId,
            contactExternalReference: externalReference,
            displayName,
            age: integerField(event.payload.age),
            location: stringField(event.payload.location),
            profileUrl: safeHttpUrl(event.payload.profileUrl),
          },
          allowedTopics: ruleRows[0] ? parseStringArray(ruleRows[0].topicsJson) : [],
          goalKeywords: [
            '相手が婚活意思を明示した',
            '相手からLINEを受領した',
          ],
          conversationGuidance: {
            desiredRelationship: '結婚を希望する相手と、真剣な婚活を進める',
            contactExchangeDirection: 'receive_only',
            requiredConversationFields: ['marriage_intent', 'line_contact'],
            tone: stringField(successCondition.conversationTone),
            replyLength: stringField(successCondition.replyLength),
            questionFrequency: stringField(successCondition.questionFrequency),
            persona: stringField(successCondition.persona),
            forbiddenPhrases: unknownStringArray(successCondition.forbiddenPhrases, 30, 80),
            escalationTriggers: unknownStringArray(successCondition.escalationTriggers, 30, 80),
            telegramNgRules: telegramLearning.ngRules,
            telegramStyleProfile: telegramLearning.profile,
          },
        }),
        status: 'pending',
        priority: 15,
        runAfter: now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
      return { conversationId: storedConversationId };
    }
    if (suggestedReply && objectField(event.payload.contactExchange).detected === true) {
      return { conversationId: storedConversationId };
    }
    if (suggestedReply) {
      const ruleRows = await db.select().from(automationRules).where(eq(automationRules.userId, event.userId)).limit(1);
      const rule = ruleRows[0];
      const successCondition = rule ? parseObject(rule.successConditionJson) : {};
      const allowedTopics = rule ? parseStringArray(rule.topicsJson) : [];
      const blockedTopics = rule ? parseStringArray(rule.blockedTopicsJson) : [];
      const detectedTopics = unknownStringArray(event.payload.detectedTopics, 5, 40);
      const forbiddenPhrases = unknownStringArray(successCondition.forbiddenPhrases, 30, 80);
      const escalationTriggers = unknownStringArray(successCondition.escalationTriggers, 30, 80);
      let assessment = assessReply(suggestedReply, boundedInteger(event.payload.confidence, 0, 100) ?? 0, {
        mode: rule?.automationMode ?? 'approval',
        minimumConfidence: rule?.minimumConfidence ?? 85,
        allowedTopics,
        blockedTopics,
        requireApprovalForScheduling: successCondition.requireApprovalForScheduling !== false,
        requireApprovalForContactExchange: false,
        contactExchangeDirection: 'receive_only',
      });
      const blockedDetectedTopic = detectedTopics.find((topic) => topicMatchesAny(topic, blockedTopics));
      if (blockedDetectedTopic) {
        assessment = { action: 'block', reasons: [`禁止テーマ「${blockedDetectedTopic}」を検出しました`], confidence: assessment.confidence };
      } else if (forbiddenPhrases.some((phrase) => suggestedReply.toLocaleLowerCase('ja-JP').includes(phrase.toLocaleLowerCase('ja-JP')))) {
        assessment = { action: 'block', reasons: ['禁止表現を返信案に検出しました'], confidence: assessment.confidence };
      } else if (escalationTriggers.some((trigger) => body.toLocaleLowerCase('ja-JP').includes(trigger.toLocaleLowerCase('ja-JP')))) {
        assessment = { action: 'request_approval', reasons: ['本人判断へ戻す条件を検出しました'], confidence: assessment.confidence };
      } else if (
        assessment.action === 'send' &&
        allowedTopics.length > 0 &&
        (detectedTopics.length === 0 || detectedTopics.some((topic) => !topicMatchesAny(topic, allowedTopics) && !mandatoryConversationTopic(topic)))
      ) {
        assessment = { action: 'request_approval', reasons: ['許可テーマ内と確認できませんでした'], confidence: assessment.confidence };
      }
      let replyRunAfter = now;
      if (assessment.action === 'send') {
        const [latestOutgoingRows, queuedOutgoingRows, todaysOutgoingRows, recentOutgoingRows, exactHistoricalOutgoingRows] = await Promise.all([
          db
            .select({ createdAt: messages.createdAt })
            .from(messages)
            .where(and(
              eq(messages.conversationId, storedConversationId),
              eq(messages.direction, 'outgoing'),
              inArray(messages.sendState, ['queued', 'sent']),
            ))
            .orderBy(desc(messages.createdAt))
            .limit(1),
          db
            .select({ id: messages.id })
            .from(messages)
            .where(and(
              eq(messages.conversationId, storedConversationId),
              eq(messages.direction, 'outgoing'),
              eq(messages.sendState, 'queued'),
            ))
            .limit(1),
          db
            .select({ id: messages.id })
            .from(messages)
            .where(and(
              eq(messages.conversationId, storedConversationId),
              eq(messages.direction, 'outgoing'),
              inArray(messages.sendState, ['queued', 'sent']),
              gte(messages.createdAt, startOfCurrentJapanDay(now)),
            )),
          db
            .select({ body: messages.body })
            .from(messages)
            .innerJoin(conversations, eq(messages.conversationId, conversations.id))
            .where(and(
              eq(conversations.userId, event.userId),
              eq(messages.direction, 'outgoing'),
              inArray(messages.sendState, ['queued', 'sent']),
              gte(messages.createdAt, new Date(now.getTime() - REPEATED_OUTGOING_WINDOW_MS)),
            ))
            .orderBy(desc(messages.createdAt))
            .limit(200),
          db
            .select({ id: messages.id })
            .from(messages)
            .innerJoin(conversations, eq(messages.conversationId, conversations.id))
            .where(and(
              eq(conversations.userId, event.userId),
              eq(messages.direction, 'outgoing'),
              inArray(messages.sendState, ['queued', 'sent']),
              eq(messages.body, suggestedReply),
            ))
            .limit(1),
        ]);
        if (exactHistoricalOutgoingRows.length > 0 || hasRecentDuplicateOutgoingMessage(suggestedReply, recentOutgoingRows.map((row) => row.body))) {
          assessment = {
            action: 'block',
            reasons: ['過去に送った同一文面のため送信を禁止しました'],
            confidence: assessment.confidence,
          };
        } else {
          const plan = planAutomatedReply({
            now,
            latestOutgoingAt: latestOutgoingRows[0]?.createdAt,
            outgoingCountToday: todaysOutgoingRows.length,
            hasQueuedOutgoing: queuedOutgoingRows.length > 0,
          });
          if (plan.action === 'hold') {
            assessment = {
              action: 'request_approval',
              reasons: [replyHoldReason(plan.reason)],
              confidence: assessment.confidence,
            };
          } else {
            replyRunAfter = plan.runAfter;
          }
        }
      }
      const draftId = `draft_${eventKey}`;
      await db.insert(messages).values({
        id: draftId,
        conversationId: storedConversationId,
        direction: 'outgoing',
        body: suggestedReply,
        sendState: assessment.action === 'send' ? 'queued' : 'draft',
        modelClass: stringField(event.payload.modelClass) ?? 'worker_generated',
        createdAt: now,
      }).onConflictDoUpdate({
        target: messages.id,
        set: { body: suggestedReply, sendState: assessment.action === 'send' ? 'queued' : 'draft' },
      });
      if (assessment.action === 'send') {
        await db.insert(automationJobs).values({
          id: `send_${draftId}`,
          userId: event.userId,
          connectionId: event.connectionId,
          type: 'send_message',
          payloadJson: JSON.stringify({ conversationId: storedConversationId, messageId: draftId, body: suggestedReply, provider, threadUrl: safeHttpUrl(event.payload.threadUrl) }),
          status: 'pending',
          priority: 10,
          runAfter: replyRunAfter,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();
      } else {
        await db.update(conversations).set({ status: 'escalated', updatedAt: now }).where(eq(conversations.id, storedConversationId));
      }
      return { conversationId: storedConversationId, draftMessageId: draftId, replyAction: assessment.action };
    }
  }
  return { conversationId: storedConversationId };
}

async function deliverTelegramReport(event: WorkerEvent, now: Date) {
  const db = getDb();
  const eventKey = await stableKey(`${event.userId}:${event.id}`);
  const reportId = `report_${eventKey}`;
  const existing = await db.select({ status: reports.status }).from(reports).where(eq(reports.id, reportId)).limit(1);
  if (existing[0]?.status === 'sent') return;

  const recipient = await db.select({ telegramChatId: users.telegramChatId }).from(users).where(eq(users.id, event.userId)).limit(1);
  const text = await applyTelegramReportLearning(event.userId, formatAutomationReport(event));
  const screenshotObjectKey = stringField(event.payload.screenshotObjectKey);
  await db
    .insert(reports)
    .values({
      id: reportId,
      userId: event.userId,
      conversationId: event.conversationId,
      kind: event.type,
      text,
      screenshotObjectKey,
      status: 'pending',
      createdAt: now,
    })
    .onConflictDoUpdate({ target: reports.id, set: { text, screenshotObjectKey, status: 'pending' } });

  if (!recipient[0]?.telegramChatId) return;

  try {
    const object = screenshotObjectKey ? await getFilesBucket().get(screenshotObjectKey) : null;
    const telegramResult = await sendTelegramReport({
      chatId: recipient[0].telegramChatId,
      text,
      buttons: Boolean(stringField(event.payload.suggestedReply)) && event.payload.approvalAllowed !== false
        ? [
            { text: '送信を承認', callbackData: `approve:approval_${eventKey}` },
            { text: '取り消す', callbackData: `cancel:approval_${eventKey}` },
          ]
        : undefined,
      image: object
        ? {
            bytes: await object.arrayBuffer(),
            contentType: object.httpMetadata?.contentType ?? 'image/png',
            filename: `match-${event.id}.png`,
          }
        : undefined,
    });
    await db.update(reports).set({ status: 'sent', telegramMessageId: telegramResult.result?.message_id?.toString() }).where(eq(reports.id, reportId));
  } catch {
    await db.update(reports).set({ status: 'failed' }).where(eq(reports.id, reportId));
  }
}

async function ensureApprovalJob(event: WorkerEvent, now: Date) {
  const suggestedReply = stringField(event.payload.suggestedReply);
  if (!event.conversationId || !suggestedReply) return;
  const eventKey = await stableKey(`${event.userId}:${event.id}`);
  await getDb()
    .insert(automationJobs)
    .values({
      id: `approval_${eventKey}`,
      userId: event.userId,
      connectionId: event.connectionId,
      type: 'send_approved_reply',
      payloadJson: JSON.stringify({ conversationId: event.conversationId, messageId: stringField(event.payload.messageId), body: suggestedReply, provider: stringField(event.payload.provider), threadUrl: safeHttpUrl(event.payload.threadUrl) }),
      status: 'awaiting_approval',
      priority: 5,
      runAfter: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

async function ensureLineBlockJob(event: WorkerEvent, conversationId: string, provider: string, now: Date) {
  const receivedAt = stringField(event.payload.lineReceivedAt) ?? event.occurredAt;
  const plan = planLineBlock(receivedAt);
  const db = getDb();
  const rows = await db.select({
    contactId: contacts.id,
    externalReference: contacts.externalReference,
    displayName: contacts.displayName,
    profileUrl: contacts.profileUrl,
    threadUrl: conversations.threadUrl,
  })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, event.userId), eq(conversations.connectionId, event.connectionId)))
    .limit(1);
  const contact = rows[0];
  if (!contact) throw new Error('line_block_contact_not_found');
  const jobKey = await stableKey(`${event.userId}:${conversationId}:line_block`);
  await db.insert(automationJobs).values({
    id: `block_${jobKey}`,
    userId: event.userId,
    connectionId: event.connectionId,
    type: 'block_contact',
    payloadJson: JSON.stringify({
      conversationId,
      contactId: contact.contactId,
      contactExternalReference: contact.externalReference,
      displayName: contact.displayName,
      provider,
      profileUrl: contact.profileUrl,
      threadUrl: contact.threadUrl,
      lineReceivedAt: plan.receivedAt.toISOString(),
      blockNotBefore: plan.notBefore.toISOString(),
      blockDeadline: plan.deadline.toISOString(),
      reason: 'LINE受領後の36〜48時間ブロックルール',
    }),
    status: 'pending',
    priority: 8,
    runAfter: plan.notBefore,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  return plan;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 4000) : undefined;
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function integerField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const integer = integerField(value);
  return typeof integer === 'number' && integer >= minimum && integer <= maximum ? integer : undefined;
}

function safeHttpUrl(value: unknown) {
  const text = stringField(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function automationModeField(value: unknown) {
  return value === 'full_auto' || value === 'approval' || value === 'draft_only' ? value : undefined;
}

function isIsoDate(value: unknown) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function unknownStringArray(value: unknown, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, maximumLength))
    .slice(0, maximumItems);
}

function topicMatchesAny(topic: string, candidates: string[]) {
  const normalized = topic.toLocaleLowerCase('ja-JP');
  return candidates.some((candidate) => {
    const reference = candidate.toLocaleLowerCase('ja-JP');
    return normalized.includes(reference) || reference.includes(normalized);
  });
}

function mandatoryConversationTopic(topic: string) {
  return /(婚活|結婚|結婚観|将来|line|ライン|連絡先)/i.test(topic);
}

function assessCandidate(payload: Record<string, unknown>, rule: typeof automationRules.$inferSelect) {
  const age = integerField(payload.age);
  const distanceKm = boundedInteger(payload.distanceKm, 0, 1000);
  const text = `${stringField(payload.profileSnippet) ?? ''} ${stringField(payload.location) ?? ''}`.toLocaleLowerCase('ja-JP');
  const topics = parseStringArray(rule.topicsJson);
  const conditions = parseObject(rule.successConditionJson);
  const preferredLocations = unknownStringArray(conditions.preferredLocations, 20, 40).map((item) => item.toLocaleLowerCase('ja-JP'));
  const requiredKeywords = unknownStringArray(conditions.requiredProfileKeywords, 20, 40).map((item) => item.toLocaleLowerCase('ja-JP'));
  const excludedKeywords = unknownStringArray(conditions.excludedProfileKeywords, 20, 40).map((item) => item.toLocaleLowerCase('ja-JP'));
  const ageEligible = age === undefined || (age >= 30 && age <= 70);
  const radiusEligible = distanceKm === undefined || rule.radiusKm === null || distanceKm <= rule.radiusKm;
  const locationEligible = preferredLocations.length === 0 || preferredLocations.some((location) => text.includes(location));
  const keywordsEligible = requiredKeywords.length === 0 || requiredKeywords.some((keyword) => text.includes(keyword));
  const excluded = excludedKeywords.some((keyword) => text.includes(keyword));
  const matchedTopics = topics.filter((topic) => text.includes(topic.toLocaleLowerCase('ja-JP'))).length;
  const extracted = extractMarriageProfileFacts(stringField(payload.profileSnippet) ?? '');
  const marriageAssessment = assessMarriageCandidate({
    provider: stringField(payload.provider),
    age,
    profileText: stringField(payload.profileSnippet),
    annualIncomeMinimum: boundedInteger(payload.annualIncomeMinimum, 0, 10_000) ?? extracted.annualIncomeMinimum,
    occupation: stringField(payload.occupation),
    likesCount: boundedInteger(payload.likesCount, 0, 1_000_000) ?? extracted.likesCount,
    hasNewBadge: payload.hasNewBadge === true || extracted.hasNewBadge,
    hasFacePhoto: payload.hasFacePhoto === true,
    isPaidMember: payload.isPaidMember === true || extracted.isPaidMember,
  });
  let score = 35;
  if (age !== undefined) score += ageEligible ? 30 : -30;
  if (distanceKm !== undefined && rule.radiusKm !== null) score += radiusEligible ? 20 : -20;
  if (preferredLocations.length > 0) score += locationEligible ? 15 : -15;
  if (requiredKeywords.length > 0) score += keywordsEligible ? 15 : -15;
  if (excluded) score -= 45;
  score += Math.min(30, matchedTopics * 10);
  if (!marriageAssessment.eligible) score -= 60;
  return { eligible: ageEligible && radiusEligible && locationEligible && keywordsEligible && !excluded && marriageAssessment.eligible, score: Math.max(0, Math.min(100, score)), reasons: marriageAssessment.reasons };
}

async function requireOwnedConversation(conversationId: string, userId: string, connectionId: string) {
  const rows = await getDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId), eq(conversations.connectionId, connectionId)))
    .limit(1);
  if (!rows[0]) throw new Error('conversation_not_owned');
}

async function stableKey(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function recordAcquiredContact(event: WorkerEvent, conversationId: string, lineKey: string | undefined, now: Date) {
  const db = getDb();
  const rows = await db.select({ contactId: contacts.id, displayName: contacts.displayName, age: contacts.age })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, event.userId)))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const nameAgeKey = await acquiredNameAgeHash({ displayName: contact.displayName, age: contact.age });
  const keys = [
    nameAgeKey ? { kind: 'name_age' as const, hash: nameAgeKey } : undefined,
    lineKey ? { kind: 'line' as const, hash: lineKey } : undefined,
  ].filter((item): item is { kind: 'line' | 'name_age'; hash: string } => Boolean(item));
  for (const key of keys) {
    await db.insert(acquiredContactKeys).values({
      id: `acquired_${crypto.randomUUID()}`,
      userId: event.userId,
      keyKind: key.kind,
      keyHash: key.hash,
      contactId: contact.contactId,
      createdAt: now,
    }).onConflictDoNothing();
  }
}

async function isPreviouslyAcquired(userId: string, displayName: string, age: number | undefined, nameAgeKey: string | undefined, now: Date) {
  const db = getDb();
  if (nameAgeKey && await hasAcquiredKey(userId, 'name_age', nameAgeKey)) return true;

  if (!displayName || age === undefined) return false;
  const historic = await db
    .select({ contactId: contacts.id, displayName: contacts.displayName, age: contacts.age })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(and(eq(conversations.userId, userId), eq(conversations.status, 'goal_reached')))
    .limit(5000);
  const match = historic.find((contact) => sameAcquiredNameAge(
    { displayName, age },
    { displayName: contact.displayName, age: contact.age },
  ));
  if (!match || !nameAgeKey) return Boolean(match);

  await db.insert(acquiredContactKeys).values({
    id: `acquired_${crypto.randomUUID()}`,
    userId,
    keyKind: 'name_age',
    keyHash: nameAgeKey,
    contactId: match.contactId,
    createdAt: now,
  }).onConflictDoNothing();
  return true;
}

async function hasAcquiredKey(userId: string, kind: 'line' | 'name_age', hash: string) {
  const rows = await getDb().select({ id: acquiredContactKeys.id }).from(acquiredContactKeys).where(and(
    eq(acquiredContactKeys.userId, userId),
    eq(acquiredContactKeys.keyKind, kind),
    eq(acquiredContactKeys.keyHash, hash),
  )).limit(1);
  return Boolean(rows[0]);
}

function startOfCurrentJapanDay(now: Date) {
  const japanOffsetMs = 9 * 60 * 60 * 1000;
  const japanNow = new Date(now.getTime() + japanOffsetMs);
  return new Date(Date.UTC(japanNow.getUTCFullYear(), japanNow.getUTCMonth(), japanNow.getUTCDate()) - japanOffsetMs);
}
