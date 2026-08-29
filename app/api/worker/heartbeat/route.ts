import { getDb } from '@/db';
import { appConnections, users, workerBindings, workerHeartbeats } from '@/db/schema';
import { authorizeWorkerRequest } from '@/lib/worker-auth';
import { getConnectorDefinition } from '@/lib/automation/connectors';
import { eq } from 'drizzle-orm';
import { sendWorkerStatusAlert } from '@/lib/worker-status-alert';

type HeartbeatBody = {
  workerId?: string;
  userId?: string;
  status?: 'online' | 'busy' | 'degraded' | 'offline';
  capabilities?: string[];
  version?: string;
};

export async function POST(request: Request) {
  const worker = await authorizeWorkerRequest(request);
  if (!worker) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: HeartbeatBody;
  try {
    body = (await request.json()) as HeartbeatBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (
    !body.workerId ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(body.workerId) ||
    !body.userId ||
    body.userId.length > 200 ||
    !body.status ||
    !['online', 'busy', 'degraded', 'offline'].includes(body.status) ||
    !body.version ||
    body.version.length > 80
  ) {
    return Response.json({ error: 'invalid_heartbeat' }, { status: 400 });
  }
  if (body.workerId !== worker.workerId || body.userId !== worker.userId) {
    return Response.json({ error: 'worker_binding_mismatch' }, { status: 403 });
  }

  const now = new Date();
  const db = getDb();
  const previousRows = await db.select({ status: workerHeartbeats.status, lastSeenAt: workerHeartbeats.lastSeenAt }).from(workerHeartbeats).where(eq(workerHeartbeats.workerId, worker.workerId)).limit(1);
  await db
    .insert(workerHeartbeats)
    .values({
      workerId: worker.workerId,
      userId: worker.userId,
      status: body.status,
      capabilitiesJson: JSON.stringify((body.capabilities ?? []).filter((capability) => typeof capability === 'string').slice(0, 30)),
      version: body.version.slice(0, 80),
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: {
        status: body.status,
        capabilitiesJson: JSON.stringify((body.capabilities ?? []).filter((capability) => typeof capability === 'string').slice(0, 30)),
        version: body.version.slice(0, 80),
        lastSeenAt: now,
      },
    });
  await db.update(workerBindings).set({ lastUsedAt: now, updatedAt: now }).where(eq(workerBindings.workerId, worker.workerId));

  const previous = previousRows[0];
  const recovered = Boolean(previous && now.getTime() - previous.lastSeenAt.getTime() >= 120_000 && ['online', 'busy'].includes(body.status));
  if (recovered) {
    await sendWorkerStatusAlert(worker.userId, worker.workerId, 'recovered', now).catch(() => undefined);
  } else if ((body.status === 'degraded' || body.status === 'offline') && previous?.status !== body.status) {
    await sendWorkerStatusAlert(worker.userId, worker.workerId, body.status, now).catch(() => undefined);
  }

  const [connectionRows, userRows] = await Promise.all([
    db
      .select({ id: appConnections.id, provider: appConnections.provider, status: appConnections.status })
      .from(appConnections)
      .where(eq(appConnections.userId, worker.userId)),
    db
      .select({ automationState: users.automationState })
      .from(users)
      .where(eq(users.id, worker.userId))
      .limit(1),
  ]);

  return Response.json({
    ok: true,
    serverTime: now.toISOString(),
    automationState: userRows[0]?.automationState ?? 'paused',
    connections: connectionRows.map((connection) => ({
      ...connection,
      entryUrl: getConnectorDefinition(connection.provider)?.entryUrl ?? null,
    })),
  });
}
