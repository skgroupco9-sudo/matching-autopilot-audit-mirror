import { getD1, getDb } from '@/db';
import { getPersonalUser } from '@/app/personal-auth';
import { workerBindings, workerHeartbeats } from '@/db/schema';
import { hashWorkerToken, isValidWorkerId } from '@/lib/worker-auth-core';
import { validateJsonMutation } from '@/lib/request-security';
import { and, desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const bindings = await getDb()
    .select({
      workerId: workerBindings.workerId,
      status: workerBindings.status,
      lastUsedAt: workerBindings.lastUsedAt,
      createdAt: workerBindings.createdAt,
      updatedAt: workerBindings.updatedAt,
    })
    .from(workerBindings)
    .where(eq(workerBindings.userId, user.userId))
    .orderBy(desc(workerBindings.updatedAt));
  return Response.json({
    bindings: bindings.map((binding) => ({
      ...binding,
      lastUsedAt: binding.lastUsedAt?.toISOString() ?? null,
      createdAt: binding.createdAt.toISOString(),
      updatedAt: binding.updatedAt.toISOString(),
    })),
  }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  let body: { workerId?: unknown };
  try {
    body = await request.json() as { workerId?: unknown };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
  if (!isValidWorkerId(workerId)) return Response.json({ error: 'invalid_worker_id' }, { status: 400 });

  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hashWorkerToken(token);
  const now = new Date();
  const db = getDb();
  const existingOwner = await db.select({ userId: workerBindings.userId }).from(workerBindings).where(eq(workerBindings.workerId, workerId)).limit(1);
  if (existingOwner[0] && existingOwner[0].userId !== user.userId) {
    return Response.json({ error: 'worker_id_in_use' }, { status: 409 });
  }
  await getD1().batch([
    getD1().prepare(`INSERT INTO worker_bindings
      (worker_id, user_id, token_hash, status, last_used_at, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, ?, ?)
      ON CONFLICT(worker_id) DO UPDATE SET
        token_hash = excluded.token_hash,
        status = 'active',
        last_used_at = NULL,
        updated_at = excluded.updated_at`)
      .bind(workerId, user.userId, tokenHash, now.getTime(), now.getTime()),
    getD1().prepare('DELETE FROM worker_heartbeats WHERE worker_id = ? AND user_id = ?').bind(workerId, user.userId),
  ]);
  return Response.json({ workerId, token }, {
    status: 201,
    headers: { 'cache-control': 'private, no-store' },
  });
}

export async function DELETE(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  let body: { workerId?: unknown };
  try {
    body = await request.json() as { workerId?: unknown };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
  if (!isValidWorkerId(workerId)) return Response.json({ error: 'invalid_worker_id' }, { status: 400 });

  const now = new Date();
  const db = getDb();
  const updated = await db.update(workerBindings)
    .set({ status: 'revoked', updatedAt: now })
    .where(and(eq(workerBindings.workerId, workerId), eq(workerBindings.userId, user.userId)))
    .returning({ workerId: workerBindings.workerId });
  if (!updated[0]) return Response.json({ error: 'worker_binding_not_found' }, { status: 404 });
  await db.delete(workerHeartbeats).where(and(eq(workerHeartbeats.workerId, workerId), eq(workerHeartbeats.userId, user.userId)));
  return Response.json({ ok: true });
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
