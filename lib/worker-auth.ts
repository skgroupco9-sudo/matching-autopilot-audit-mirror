import { env } from 'cloudflare:workers';
import { getD1 } from '@/db';
import { hashWorkerToken, isValidWorkerId, isValidWorkerToken } from '@/lib/worker-auth-core';

export type AuthorizedWorker = {
  workerId: string;
  userId: string;
};

export function isWorkerAuthorized(request: Request): boolean {
  const configuredSecret = env.WORKER_SHARED_SECRET;
  if (!configuredSecret) return false;

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;

  return secretsEqual(authorization.slice(7), configuredSecret);
}

export async function authorizeWorkerRequest(request: Request): Promise<AuthorizedWorker | null> {
  if (!isWorkerAuthorized(request)) return null;

  const workerId = request.headers.get('x-worker-id') ?? '';
  const workerToken = request.headers.get('x-worker-token') ?? '';
  if (!isValidWorkerId(workerId) || !isValidWorkerToken(workerToken)) return null;

  const tokenHash = await hashWorkerToken(workerToken);
  const binding = await getD1()
    .prepare(`SELECT worker_id, user_id, token_hash
      FROM worker_bindings
      WHERE worker_id = ? AND status = 'active'
      LIMIT 1`)
    .bind(workerId)
    .first<{ worker_id: string; user_id: string; token_hash: string }>();
  if (!binding || !secretsEqual(binding.token_hash, tokenHash)) return null;

  return { workerId: binding.worker_id, userId: binding.user_id };
}

export async function authorizeWorkerForUser(request: Request, userId: string) {
  const worker = await authorizeWorkerRequest(request);
  return worker && worker.userId === userId ? worker : null;
}

export function secretsEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}
