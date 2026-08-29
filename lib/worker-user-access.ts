import { getD1 } from '@/db';
import { authorizeWorkerForUser } from '@/lib/worker-auth';

export async function isKnownWorkerForUser(request: Request, userId: string) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(userId)) return false;
  const worker = await authorizeWorkerForUser(request, userId);
  if (!worker) return false;
  const knownWorker = await getD1()
    .prepare('SELECT worker_id FROM worker_heartbeats WHERE worker_id = ? AND user_id = ? AND last_seen_at >= ? LIMIT 1')
    .bind(worker.workerId, worker.userId, Date.now() - 120_000)
    .first<{ worker_id: string }>();
  return Boolean(knownWorker);
}
