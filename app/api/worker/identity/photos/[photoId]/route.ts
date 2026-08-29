import { getDb, getFilesBucket } from '@/db';
import { identityProfilePhotos } from '@/db/schema';
import { identityProfilePhotoVaultContext } from '@/lib/identity-profile';
import { decryptVaultBytes } from '@/lib/identity-vault';
import { isKnownWorkerForUser } from '@/lib/worker-user-access';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ photoId: string }> }) {
  const userId = new URL(request.url).searchParams.get('user_id') ?? '';
  if (!await isKnownWorkerForUser(request, userId)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { photoId } = await context.params;
  if (!/^pphoto_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(photoId)) {
    return Response.json({ error: 'invalid_profile_photo' }, { status: 400 });
  }
  const rows = await getDb().select().from(identityProfilePhotos).where(and(
    eq(identityProfilePhotos.id, photoId),
    eq(identityProfilePhotos.userId, userId),
    eq(identityProfilePhotos.isPrimary, true),
  )).limit(1);
  const photo = rows[0];
  if (!photo) return Response.json({ error: 'profile_photo_not_found' }, { status: 404 });
  const stored = await getFilesBucket().get(photo.objectKey);
  if (!stored) return Response.json({ error: 'profile_photo_file_missing' }, { status: 404 });
  try {
    const bytes = await decryptVaultBytes(await stored.arrayBuffer(), identityProfilePhotoVaultContext(userId, photo.id, 'bytes'));
    return new Response(bytes, {
      headers: {
        'cache-control': 'private, no-store',
        'content-length': String(bytes.byteLength),
        'content-type': photo.contentType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'profile_photo_decryption_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
