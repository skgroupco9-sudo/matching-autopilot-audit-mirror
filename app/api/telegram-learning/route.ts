import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { telegramLearningItems, telegramLearningProfiles } from '@/db/schema';
import { validateJsonMutation } from '@/lib/request-security';
import { isSafeLearningExample } from '@/lib/telegram-learning-safety';
import { redactTelegramLearningText } from '@/lib/telegram-learning-text';
import { and, desc, eq } from 'drizzle-orm';

type UpdateBody = {
  action?: 'classify' | 'approve' | 'reject' | 'delete';
  id?: string;
  category?: 'report_example' | 'conversation_example' | 'ng_rule';
};

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const [items, profiles, approvedItems] = await Promise.all([
    getDb().select({
      id: telegramLearningItems.id,
      sourceKind: telegramLearningItems.sourceKind,
      category: telegramLearningItems.category,
      status: telegramLearningItems.status,
      text: telegramLearningItems.redactedText,
      createdAt: telegramLearningItems.createdAt,
      approvedAt: telegramLearningItems.approvedAt,
    })
    .from(telegramLearningItems)
    .where(eq(telegramLearningItems.userId, user.userId))
    .orderBy(desc(telegramLearningItems.createdAt))
    .limit(100),
    getDb().select({
      summary: telegramLearningProfiles.summary,
      analyzedCount: telegramLearningProfiles.analyzedCount,
      model: telegramLearningProfiles.model,
      updatedAt: telegramLearningProfiles.updatedAt,
    }).from(telegramLearningProfiles).where(eq(telegramLearningProfiles.userId, user.userId)).limit(1),
    getDb().select({
      category: telegramLearningItems.category,
      text: telegramLearningItems.redactedText,
    })
      .from(telegramLearningItems)
      .where(and(eq(telegramLearningItems.userId, user.userId), eq(telegramLearningItems.status, 'approved')))
      .orderBy(desc(telegramLearningItems.approvedAt))
      .limit(300),
  ]);
  const safeApprovedCount = approvedItems.filter((item) => {
    if (item.category !== 'report_example' && item.category !== 'conversation_example' && item.category !== 'ng_rule') return false;
    return isSafeLearningExample(item.category, redactTelegramLearningText(item.text));
  }).length;
  const savedProfile = profiles[0];
  const profile = savedProfile && safeApprovedCount > 0 && savedProfile.analyzedCount === safeApprovedCount
    ? savedProfile
    : null;
  return Response.json({ items, profile, safeApprovedCount }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  let body: UpdateBody;
  try {
    body = await request.json() as UpdateBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.id || !/^learning_[a-f0-9-]{36}$/.test(body.id)) {
    return Response.json({ error: 'invalid_item' }, { status: 400 });
  }

  const db = getDb();
  const owned = and(eq(telegramLearningItems.id, body.id), eq(telegramLearningItems.userId, user.userId));
  const now = new Date();
  if (body.action === 'classify' && ['report_example', 'conversation_example', 'ng_rule'].includes(body.category ?? '')) {
    const updated = await db.update(telegramLearningItems).set({ category: body.category, status: 'ready', updatedAt: now }).where(owned).returning({ id: telegramLearningItems.id });
    return updated[0] ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (body.action === 'approve') {
    const updated = await db.update(telegramLearningItems).set({ status: 'approved', approvedAt: now, updatedAt: now }).where(and(owned, eq(telegramLearningItems.status, 'ready'))).returning({ id: telegramLearningItems.id });
    return updated[0] ? Response.json({ ok: true }) : Response.json({ error: 'not_ready' }, { status: 409 });
  }
  if (body.action === 'reject') {
    const updated = await db.update(telegramLearningItems).set({ status: 'rejected', updatedAt: now }).where(owned).returning({ id: telegramLearningItems.id });
    return updated[0] ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (body.action === 'delete') {
    const deleted = await db.delete(telegramLearningItems).where(owned).returning({ id: telegramLearningItems.id });
    return deleted[0] ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json({ error: 'unsupported_action' }, { status: 400 });
}
