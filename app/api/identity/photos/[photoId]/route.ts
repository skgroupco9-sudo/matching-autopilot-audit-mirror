import { getPersonalUser } from '@/app/personal-auth';
import { getDb, getFilesBucket } from '@/db';
import { identityProfilePhotos } from '@/db/schema';
import { getIdentityProfilePayload, identityProfilePhotoVaultContext } from '@/lib/identity-profile';
import { normalizeIdentityProfilePhotoCaption, normalizeIdentityProfilePhotoCategory } from '@/lib/identity-profile-photos';
import { decryptVaultBytes, encryptVaultValue } from '@/lib/identity-vault';
import { validateJsonMutation, validateSameOriginMutation } from '@/lib/request-security';
import { and, asc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ photoId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const { photoId } = await context.params;
  if (!validPhotoId(photoId)) return Response.json({ error: 'invalid_profile_photo' }, { status: 400 });
  const photo = await findPhoto(user.userId, photoId);
  if (!photo) return Response.json({ error: 'profile_photo_not_found' }, { status: 404 });
  const stored = await getFilesBucket().get(photo.objectKey);
  if (!stored) return Response.json({ error: 'profile_photo_file_missing' }, { status: 404 });
  try {
    const bytes = await decryptVaultBytes(await stored.arrayBuffer(), identityProfilePhotoVaultContext(user.userId, photo.id, 'bytes'));
    return new Response(bytes, {
      headers: {
        'cache-control': 'private, no-store',
        'content-disposition': 'inline',
        'content-length': String(bytes.byteLength),
        'content-type': photo.contentType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'profile_photo_decryption_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const { photoId } = await context.params;
  if (!validPhotoId(photoId)) return Response.json({ error: 'invalid_profile_photo' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const photo = await findPhoto(user.userId, photoId);
  if (!photo) return Response.json({ error: 'profile_photo_not_found' }, { status: 404 });
  const action = typeof body.action === 'string' ? body.action : '';
  const now = new Date();

  if (action === 'set_primary') {
    await getDb().batch([
      getDb().update(identityProfilePhotos).set({ isPrimary: false, updatedAt: now }).where(eq(identityProfilePhotos.userId, user.userId)),
      getDb().update(identityProfilePhotos).set({ isPrimary: true, updatedAt: now }).where(and(eq(identityProfilePhotos.id, photoId), eq(identityProfilePhotos.userId, user.userId))),
    ]);
  } else if (action === 'move_left' || action === 'move_right') {
    const ordered = await getDb().select().from(identityProfilePhotos).where(eq(identityProfilePhotos.userId, user.userId)).orderBy(asc(identityProfilePhotos.position), asc(identityProfilePhotos.createdAt));
    const index = ordered.findIndex((item) => item.id === photoId);
    const targetIndex = action === 'move_left' ? index - 1 : index + 1;
    if (index >= 0 && targetIndex >= 0 && targetIndex < ordered.length) {
      await getDb().batch([
        getDb().update(identityProfilePhotos).set({ position: targetIndex, updatedAt: now }).where(and(eq(identityProfilePhotos.id, photoId), eq(identityProfilePhotos.userId, user.userId))),
        getDb().update(identityProfilePhotos).set({ position: index, updatedAt: now }).where(and(eq(identityProfilePhotos.id, ordered[targetIndex].id), eq(identityProfilePhotos.userId, user.userId))),
      ]);
    }
  } else if (action === 'update_details') {
    const category = normalizeIdentityProfilePhotoCategory(body.category);
    if (!category) return Response.json({ error: 'invalid_profile_photo_metadata' }, { status: 400 });
    const caption = normalizeIdentityProfilePhotoCaption(body.caption);
    await getDb().update(identityProfilePhotos).set({
      category,
      captionCiphertext: caption ? await encryptVaultValue(caption, identityProfilePhotoVaultContext(user.userId, photoId, 'caption')) : null,
      updatedAt: now,
    }).where(and(eq(identityProfilePhotos.id, photoId), eq(identityProfilePhotos.userId, user.userId)));
  } else {
    return Response.json({ error: 'invalid_profile_photo_action' }, { status: 400 });
  }

  const identity = await getIdentityProfilePayload(user.userId, user);
  return Response.json({ photos: identity.photos }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const { photoId } = await context.params;
  if (!validPhotoId(photoId)) return Response.json({ error: 'invalid_profile_photo' }, { status: 400 });
  const photo = await findPhoto(user.userId, photoId);
  if (!photo) return Response.json({ error: 'profile_photo_not_found' }, { status: 404 });

  await getFilesBucket().delete(photo.objectKey);
  await getDb().delete(identityProfilePhotos).where(and(eq(identityProfilePhotos.id, photoId), eq(identityProfilePhotos.userId, user.userId)));
  const remaining = await getDb().select().from(identityProfilePhotos).where(eq(identityProfilePhotos.userId, user.userId)).orderBy(asc(identityProfilePhotos.position), asc(identityProfilePhotos.createdAt));
  const now = new Date();
  const updates = remaining.map((item, index) => getDb().update(identityProfilePhotos).set({
    position: index,
    isPrimary: photo.isPrimary ? index === 0 : item.isPrimary,
    updatedAt: now,
  }).where(and(eq(identityProfilePhotos.id, item.id), eq(identityProfilePhotos.userId, user.userId))));
  for (const update of updates) await update;

  const identity = await getIdentityProfilePayload(user.userId, user);
  return Response.json({ photos: identity.photos }, { headers: { 'cache-control': 'private, no-store' } });
}

async function findPhoto(userId: string, photoId: string) {
  const rows = await getDb().select().from(identityProfilePhotos).where(and(
    eq(identityProfilePhotos.id, photoId),
    eq(identityProfilePhotos.userId, userId),
  )).limit(1);
  return rows[0] ?? null;
}

function validPhotoId(photoId: string) {
  return /^pphoto_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(photoId);
}
