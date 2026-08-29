import { getDb } from '@/db';
import { automationJobs, users } from '@/db/schema';
import { getPersonalUser } from '@/app/personal-auth';
import { eq } from 'drizzle-orm';
import { validateJsonMutation } from '@/lib/request-security';

export async function GET() {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) {
    return Response.json({ authenticated: false, state: 'active' });
  }

  const record = await getDb()
    .select({ state: users.automationState })
    .from(users)
    .where(eq(users.id, authenticatedUser.userId))
    .limit(1);

  return Response.json({
    authenticated: true,
    state: record[0]?.state ?? 'paused',
  });
}

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) {
    return Response.json({ error: 'authentication_required' }, { status: 401 });
  }

  let body: { state?: 'active' | 'paused' };
  try {
    body = (await request.json()) as { state?: 'active' | 'paused' };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.state || !['active', 'paused'].includes(body.state)) {
    return Response.json({ error: 'invalid_state' }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();
  await db
    .insert(users)
    .values({
      id: authenticatedUser.userId,
      email: authenticatedUser.email,
      displayName: authenticatedUser.displayName,
      automationState: body.state,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: authenticatedUser.email,
        displayName: authenticatedUser.displayName,
        automationState: body.state,
        updatedAt: now,
      },
    });

  await db.insert(automationJobs).values({
    id: `control_${crypto.randomUUID()}`,
    userId: authenticatedUser.userId,
    connectionId: null,
    type: body.state === 'active' ? 'resume_all' : 'pause_all',
    payloadJson: '{}',
    status: 'pending',
    priority: 0,
    runAfter: now,
    createdAt: now,
    updatedAt: now,
  });

  return Response.json({ ok: true, state: body.state });
}
