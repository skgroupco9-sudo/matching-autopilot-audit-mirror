import { getD1 } from '@/db';
import { authorizeWorkerRequest } from '@/lib/worker-auth';
import { sendTerminalFailureAlert } from '@/lib/automation/failure-alert';
import { EXTERNAL_ACTION_JOB_TYPES, isExternalActionJob } from '@/lib/automation/account-safety';

type LeasedJobRow = {
  id: string;
  user_id: string;
  connection_id: string | null;
  type: string;
  payload_json: string;
  attempts: number;
  lease_until: number;
};

export async function GET(request: Request) {
  const worker = await authorizeWorkerRequest(request);
  if (!worker) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = new URL(request.url).searchParams.get('user_id');
  if (!userId) {
    return Response.json({ error: 'missing_worker_identity' }, { status: 400 });
  }
  if (userId !== worker.userId) return Response.json({ error: 'worker_binding_mismatch' }, { status: 403 });

  const d1 = getD1();
  const now = Date.now();
  const knownWorker = await d1
    .prepare(
      `SELECT worker_id
       FROM worker_heartbeats
       WHERE worker_id = ? AND user_id = ? AND last_seen_at >= ?
       LIMIT 1`,
    )
    .bind(worker.workerId, worker.userId, now - 120_000)
    .first<{ worker_id: string }>();
  if (!knownWorker) {
    return Response.json({ error: 'heartbeat_required' }, { status: 409 });
  }

  const leaseUntil = now + 90_000;
  const job = await d1
    .prepare(
      `UPDATE automation_jobs
       SET status = 'leased', lease_until = ?, leased_by = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = (
         SELECT jobs.id
         FROM automation_jobs AS jobs
         INNER JOIN users AS owner ON owner.id = jobs.user_id
         WHERE jobs.user_id = ?
           AND (
             jobs.status = 'pending'
             OR (jobs.status = 'leased' AND jobs.lease_until <= ?)
           )
           AND jobs.run_after <= ?
           AND (
             owner.automation_state = 'active'
             OR jobs.type IN ('pause_all', 'resume_all', 'start_session', 'sync_rules')
           )
         ORDER BY jobs.priority ASC, jobs.run_after ASC
         LIMIT 1
       )
       AND (
         status = 'pending'
         OR (status = 'leased' AND lease_until <= ?)
       )
       RETURNING id, user_id, connection_id, type, payload_json, attempts, lease_until`,
    )
    .bind(leaseUntil, worker.workerId, now, worker.userId, now, now, now)
    .first<LeasedJobRow>();

  if (!job) return new Response(null, { status: 204 });

  let payload: unknown;
  try {
    payload = JSON.parse(job.payload_json) as unknown;
  } catch {
    await d1
      .prepare(`UPDATE automation_jobs SET status = 'failed', last_error = 'invalid_payload_json', lease_until = NULL, leased_by = NULL, updated_at = ? WHERE id = ?`)
      .bind(now, job.id)
      .run();
    return Response.json({ error: 'invalid_job_payload' }, { status: 500 });
  }

  return Response.json({
    job: {
      id: job.id,
      userId: job.user_id,
      connectionId: job.connection_id,
      type: job.type,
      payload,
      attempts: job.attempts,
      leaseUntil: new Date(job.lease_until).toISOString(),
    },
  });
}

export async function POST(request: Request) {
  const worker = await authorizeWorkerRequest(request);
  if (!worker) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { jobId?: string; status?: 'completed' | 'failed'; error?: string; retryable?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.jobId || !body.status) {
    return Response.json({ error: 'invalid_job_result' }, { status: 400 });
  }

  const d1 = getD1();
  const now = Date.now();
  const leasedJob = await d1
    .prepare(`SELECT id, user_id, connection_id, type, payload_json, attempts FROM automation_jobs WHERE id = ? AND user_id = ? AND status = 'leased' AND leased_by = ? LIMIT 1`)
    .bind(body.jobId, worker.userId, worker.workerId)
    .first<{ id: string; user_id: string; connection_id: string | null; type: string; payload_json: string; attempts: number }>();
  if (!leasedJob) return Response.json({ error: 'job_not_leased_by_worker' }, { status: 409 });

  const shouldRetry = body.status === 'failed' && body.retryable === true && leasedJob.attempts < 5;
  const nextStatus = shouldRetry ? 'pending' : body.status;
  const retryDelay = shouldRetry ? Math.min(300_000, 5_000 * 2 ** Math.max(0, leasedJob.attempts - 1)) : 0;
  const result = await d1
    .prepare(
      `UPDATE automation_jobs
       SET status = ?, last_error = ?, lease_until = NULL, leased_by = NULL, run_after = ?, updated_at = ?
       WHERE id = ? AND status = 'leased' AND leased_by = ?
       RETURNING id`,
    )
    .bind(nextStatus, body.error?.slice(0, 2000) ?? null, now + retryDelay, now, body.jobId, worker.workerId)
    .first<{ id: string }>();

  if (!result) return Response.json({ error: 'job_lease_lost' }, { status: 409 });
  if (!shouldRetry) {
    await reconcileTerminalJob(d1, leasedJob, body.status, now);
    if (body.status === 'failed') {
      await sendTerminalFailureAlert({ userId: worker.userId, jobId: body.jobId, type: leasedJob.type, error: body.error, now: new Date(now) }).catch(() => undefined);
    }
  }
  return Response.json({ ok: true, status: nextStatus, retryAt: shouldRetry ? new Date(now + retryDelay).toISOString() : null });
}

async function reconcileTerminalJob(
  d1: D1Database,
  job: { user_id: string; connection_id: string | null; type: string; payload_json: string },
  status: 'completed' | 'failed',
  now: number,
) {
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(job.payload_json) as unknown;
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return;
  }
  if (['send_message', 'send_approved_reply'].includes(job.type) && typeof payload.messageId === 'string') {
    await d1
      .prepare(
        `UPDATE messages SET send_state = ? WHERE id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)`,
      )
      .bind(status === 'completed' ? 'sent' : 'failed', payload.messageId, job.user_id)
      .run();
  }
  if (job.type === 'like_contact' && status === 'failed' && typeof payload.contactId === 'string') {
    await d1
      .prepare(`UPDATE contacts SET status = 'candidate' WHERE id = ? AND user_id = ? AND status = 'liked'`)
      .bind(payload.contactId, job.user_id)
      .run();
  }
  if (job.type === 'start_session' && status === 'failed') {
    await d1
      .prepare(`UPDATE app_connections SET status = 'error', updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(now, job.connection_id, job.user_id)
      .run();
  }
  if (status === 'failed' && job.connection_id && isExternalActionJob(job.type)) {
    const actionTypes = EXTERNAL_ACTION_JOB_TYPES.map(() => '?').join(', ');
    await d1
      .prepare(
        `UPDATE messages
         SET send_state = 'cancelled'
         WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ? AND connection_id = ?)
           AND id IN (
             SELECT json_extract(payload_json, '$.messageId')
             FROM automation_jobs
             WHERE user_id = ? AND connection_id = ?
               AND status IN ('pending', 'awaiting_approval')
               AND type IN (${actionTypes})
           )`,
      )
      .bind(job.user_id, job.connection_id, job.user_id, job.connection_id, ...EXTERNAL_ACTION_JOB_TYPES)
      .run();
    await d1
      .prepare(
        `UPDATE automation_jobs
         SET status = 'cancelled', last_error = 'connection_paused_after_terminal_action_failure', updated_at = ?
         WHERE user_id = ? AND connection_id = ?
           AND status IN ('pending', 'awaiting_approval')
           AND type IN (${actionTypes})`,
      )
      .bind(now, job.user_id, job.connection_id, ...EXTERNAL_ACTION_JOB_TYPES)
      .run();
    await d1
      .prepare(`UPDATE app_connections SET status = 'needs_verification', updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(now, job.connection_id, job.user_id)
      .run();
  }
}
