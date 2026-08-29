import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { aiCredentials, telegramLearningItems, telegramLearningProfiles } from '@/db/schema';
import { aiCredentialVaultContext } from '@/lib/ai-credentials';
import { decryptVaultValue } from '@/lib/identity-vault';
import { validateJsonMutation } from '@/lib/request-security';
import {
  classifyTelegramLearningBatch,
  synthesizeTelegramLearningProfile,
  telegramLearningAnalysisLimits,
  type LearningCategory,
} from '@/lib/telegram-learning-analysis';
import { redactTelegramLearningText } from '@/lib/telegram-learning-text';
import { isSafeLearningExample } from '@/lib/telegram-learning-safety';
import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return json({ error: 'authentication_required' }, 401);

  const db = getDb();
  const [pendingItems, approvedItems, credentialRows, previousProfileRows] = await Promise.all([
    db.select({ id: telegramLearningItems.id, text: telegramLearningItems.redactedText })
      .from(telegramLearningItems)
      .where(and(eq(telegramLearningItems.userId, user.userId), eq(telegramLearningItems.status, 'pending')))
      .orderBy(desc(telegramLearningItems.createdAt))
      .limit(telegramLearningAnalysisLimits.maximumItems),
    db.select({ category: telegramLearningItems.category, text: telegramLearningItems.redactedText })
      .from(telegramLearningItems)
      .where(and(eq(telegramLearningItems.userId, user.userId), eq(telegramLearningItems.status, 'approved')))
      .orderBy(desc(telegramLearningItems.approvedAt))
      .limit(300),
    db.select({ apiKeyCiphertext: aiCredentials.apiKeyCiphertext, model: aiCredentials.model, enabled: aiCredentials.enabled })
      .from(aiCredentials)
      .where(eq(aiCredentials.userId, user.userId))
      .limit(1),
    db.select({
      conversationGuidance: telegramLearningProfiles.conversationGuidance,
      reportExample: telegramLearningProfiles.reportExample,
      ngRulesJson: telegramLearningProfiles.ngRulesJson,
      summary: telegramLearningProfiles.summary,
      analyzedCount: telegramLearningProfiles.analyzedCount,
      model: telegramLearningProfiles.model,
      updatedAt: telegramLearningProfiles.updatedAt,
    }).from(telegramLearningProfiles).where(eq(telegramLearningProfiles.userId, user.userId)).limit(1),
  ]);
  const unlearnableIds = pendingItems.filter((item) => item.text.startsWith('【話者不明・確認要】')).map((item) => item.id);
  const items = pendingItems
    .filter((item) => !unlearnableIds.includes(item.id))
    .map((item) => ({ ...item, text: redactTelegramLearningText(item.text) }));
  const savedCredential = credentialRows[0];
  if (!savedCredential?.enabled) return json({ error: 'ai_not_configured' }, 409);

  let credential: { apiKey: string; model: string };
  try {
    credential = {
      apiKey: await decryptVaultValue(savedCredential.apiKeyCiphertext, aiCredentialVaultContext(user.userId)),
      model: savedCredential.model,
    };
  } catch {
    return json({ error: 'ai_credential_load_failed' }, 500);
  }

  try {
    const privacyScanAt = new Date();
    if (unlearnableIds.length) {
      await db.update(telegramLearningItems)
        .set({ category: 'unclassified', status: 'rejected', approvedAt: null, updatedAt: privacyScanAt })
        .where(and(eq(telegramLearningItems.userId, user.userId), inArray(telegramLearningItems.id, unlearnableIds)));
    }
    if (pendingItems.length > 0 && !items.length) {
      const [remainingRows, processedRows] = await Promise.all([
        db.select({ value: count() }).from(telegramLearningItems).where(and(eq(telegramLearningItems.userId, user.userId), eq(telegramLearningItems.status, 'pending'))),
        db.select({ value: count() }).from(telegramLearningItems).where(and(eq(telegramLearningItems.userId, user.userId), ne(telegramLearningItems.status, 'pending'))),
      ]);
      return json({
        learned: 0,
        conversation: 0,
        reports: 0,
        ng: 0,
        ignored: unlearnableIds.length,
        analyzedCount: processedRows[0]?.value ?? 0,
        remainingPending: remainingRows[0]?.value ?? 0,
        profile: previousProfileRows[0] ? {
          summary: previousProfileRows[0].summary,
          model: previousProfileRows[0].model,
          updatedAt: previousProfileRows[0].updatedAt.toISOString(),
        } : null,
      }, 200);
    }
    const sanitizedItems = items.filter((item) => pendingItems.find((candidate) => candidate.id === item.id)?.text !== item.text);
    for (let offset = 0; offset < sanitizedItems.length; offset += 8) {
      await Promise.all(sanitizedItems.slice(offset, offset + 8).map((item) => db.update(telegramLearningItems)
        .set({ redactedText: item.text, updatedAt: privacyScanAt })
        .where(and(eq(telegramLearningItems.userId, user.userId), eq(telegramLearningItems.id, item.id)))));
    }
    const batches = Array.from({ length: Math.ceil(items.length / telegramLearningAnalysisLimits.classificationBatchSize) }, (_, index) => items.slice(index * telegramLearningAnalysisLimits.classificationBatchSize, (index + 1) * telegramLearningAnalysisLimits.classificationBatchSize));
    const classifications = (await Promise.all(batches.map((batch) => classifyTelegramLearningBatch(batch, credential)))).flat();
    const byId = new Map(items.map((item) => [item.id, item.text]));
    const classified: Record<Exclude<LearningCategory, 'ignore'>, string[]> = {
      conversation_example: [],
      report_example: [],
      ng_rule: [],
    };
    for (const item of classifications) {
      if (item.category !== 'ignore') classified[item.category].push(byId.get(item.id) ?? '');
    }
    const now = new Date();
    for (const category of ['conversation_example', 'report_example', 'ng_rule'] as const) {
      const ids = classifications.filter((item) => item.category === category).map((item) => item.id);
      for (let offset = 0; offset < ids.length; offset += 80) {
        await db.update(telegramLearningItems).set({ category, status: 'ready', approvedAt: null, updatedAt: now })
          .where(and(eq(telegramLearningItems.userId, user.userId), inArray(telegramLearningItems.id, ids.slice(offset, offset + 80))));
      }
    }
    const ignoredIds = classifications.filter((item) => item.category === 'ignore').map((item) => item.id);
    for (let offset = 0; offset < ignoredIds.length; offset += 80) {
      await db.update(telegramLearningItems).set({ category: 'unclassified', status: 'rejected', approvedAt: null, updatedAt: now })
        .where(and(eq(telegramLearningItems.userId, user.userId), inArray(telegramLearningItems.id, ignoredIds.slice(offset, offset + 80))));
    }
    const groupedApproved: Record<Exclude<LearningCategory, 'ignore'>, string[]> = {
      conversation_example: [],
      report_example: [],
      ng_rule: [],
    };
    for (const item of approvedItems) {
      if (item.category === 'conversation_example' || item.category === 'report_example' || item.category === 'ng_rule') {
        const redacted = redactTelegramLearningText(item.text);
        if (isSafeLearningExample(item.category, redacted)) groupedApproved[item.category].push(redacted);
      }
    }
    const previousProfileRow = previousProfileRows[0];
    const safeApprovedCount = Object.values(groupedApproved).reduce((total, values) => total + values.length, 0);
    const profile = safeApprovedCount
      ? await synthesizeTelegramLearningProfile(groupedApproved, credential)
      : null;
    const [remainingRows, awaitingApprovalRows] = await Promise.all([
      db.select({ value: count() }).from(telegramLearningItems).where(and(
        eq(telegramLearningItems.userId, user.userId),
        eq(telegramLearningItems.status, 'pending'),
      )),
      db.select({ value: count() }).from(telegramLearningItems).where(and(
        eq(telegramLearningItems.userId, user.userId),
        eq(telegramLearningItems.status, 'ready'),
      )),
    ]);
    const analyzedCount = safeApprovedCount;
    if (profile) {
      await db.insert(telegramLearningProfiles).values({
        userId: user.userId,
        conversationGuidance: profile.conversationGuidance,
        reportExample: profile.reportExample,
        ngRulesJson: JSON.stringify(profile.ngRules),
        summary: profile.summary,
        analyzedCount,
        model: credential.model,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: telegramLearningProfiles.userId,
        set: {
          conversationGuidance: profile.conversationGuidance,
          reportExample: profile.reportExample,
          ngRulesJson: JSON.stringify(profile.ngRules),
          summary: profile.summary,
          analyzedCount,
          model: credential.model,
          updatedAt: now,
        },
      });
    } else if (previousProfileRow) {
      await db.delete(telegramLearningProfiles).where(eq(telegramLearningProfiles.userId, user.userId));
    }

    return json({
      learned: analyzedCount,
      classified: items.length,
      awaitingApproval: awaitingApprovalRows[0]?.value ?? 0,
      conversation: classified.conversation_example.length,
      reports: classified.report_example.length,
      ng: classified.ng_rule.length,
      ignored: ignoredIds.length + unlearnableIds.length,
      analyzedCount,
      remainingPending: remainingRows[0]?.value ?? 0,
      profile: profile ? { summary: profile.summary, model: credential.model, updatedAt: now.toISOString() } : null,
    }, 200);
  } catch (error) {
    const reason = error instanceof Error && /^[a-z0-9_:.-]{1,120}$/i.test(error.message) ? error.message : 'unknown';
    console.error('telegram_learning_analysis_failed', reason);
    return json({ error: 'learning_analysis_failed', reason }, 502);
  }
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
}
