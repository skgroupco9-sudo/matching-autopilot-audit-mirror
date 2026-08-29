import { getD1, getFilesBucket } from '@/db';
import { screenshotPrefixForUser } from '@/lib/screenshot-retention';
import { authorizeWorkerRequest } from '@/lib/worker-auth';

const supportedContentTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const maximumScreenshotBytes = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const worker = await authorizeWorkerRequest(request);
  if (!worker) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = request.headers.get('x-user-id');
  const eventId = request.headers.get('x-event-id');
  const contentType = request.headers.get('content-type')?.split(';')[0];
  if (!userId || !eventId || !contentType || !supportedContentTypes.has(contentType)) {
    return Response.json({ error: 'invalid_screenshot_metadata' }, { status: 400 });
  }
  if (userId !== worker.userId) return Response.json({ error: 'worker_binding_mismatch' }, { status: 403 });

  const knownWorker = await getD1()
    .prepare(`SELECT worker_id FROM worker_heartbeats WHERE worker_id = ? AND user_id = ? AND last_seen_at >= ? LIMIT 1`)
    .bind(worker.workerId, worker.userId, Date.now() - 120_000)
    .first<{ worker_id: string }>();
  if (!knownWorker) return Response.json({ error: 'heartbeat_required' }, { status: 409 });

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumScreenshotBytes) {
    return Response.json({ error: 'invalid_screenshot_size' }, { status: 413 });
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > maximumScreenshotBytes) {
    return Response.json({ error: 'invalid_screenshot_size' }, { status: 413 });
  }

  const safeEventId = eventId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const objectKey = `${screenshotPrefixForUser(worker.userId)}${safeEventId}-${crypto.randomUUID()}.${extension}`;

  await getFilesBucket().put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { userId: worker.userId, eventId },
  });

  return Response.json({ objectKey }, { status: 201 });
}
