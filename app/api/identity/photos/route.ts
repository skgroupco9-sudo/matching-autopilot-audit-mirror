import { getPersonalUser } from '@/app/personal-auth';
import { getDb, getFilesBucket } from '@/db';
import { identityProfilePhotos } from '@/db/schema';
import { getIdentityProfilePayload, identityProfilePhotoVaultContext } from '@/lib/identity-profile';
import {
  detectIdentityProfilePhotoContentType,
  identityProfilePhotoLimits,
  normalizeIdentityProfilePhotoCaption,
  normalizeIdentityProfilePhotoCategory,
} from '@/lib/identity-profile-photos';
import { encryptVaultBytes, encryptVaultValue, isIdentityVaultConfigured } from '@/lib/identity-vault';
import { validateMultipartMutation } from '@/lib/request-security';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const identity = await getIdentityProfilePayload(user.userId, user);
  return Response.json({ photos: identity.photos, limits: identity.photoLimits }, {
    headers: { 'cache-control': 'private, no-store' },
  });
}

export async function POST(request: Request) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateMultipartMutation(request);
  if (requestError) return requestError;
  if (!isIdentityVaultConfigured()) return Response.json({ error: 'identity_vault_not_configured' }, { status: 503 });

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > identityProfilePhotoLimits.maximumFileBytes + 512 * 1024) {
    return Response.json({ error: 'profile_photo_too_large' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'invalid_form_data' }, { status: 400 });
  }

  const file = formData.get('file');
  const category = normalizeIdentityProfilePhotoCategory(formData.get('category'));
  const caption = normalizeIdentityProfilePhotoCaption(formData.get('caption'));
  const makePrimary = formData.get('makePrimary') === 'true';
  if (!(file instanceof File) || !category || formData.get('consent') !== 'true') {
    return Response.json({ error: 'invalid_profile_photo_metadata' }, { status: 400 });
  }
  if (file.size <= 0 || file.size > identityProfilePhotoLimits.maximumFileBytes) {
    return Response.json({ error: 'profile_photo_too_large' }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectIdentityProfilePhotoContentType(bytes);
  if (!contentType) return Response.json({ error: 'unsupported_profile_photo_type' }, { status: 415 });

  const existing = await getDb()
    .select({ id: identityProfilePhotos.id, sizeBytes: identityProfilePhotos.sizeBytes, position: identityProfilePhotos.position })
    .from(identityProfilePhotos)
    .where(eq(identityProfilePhotos.userId, user.userId));
  if (existing.length >= identityProfilePhotoLimits.maximumCount) {
    return Response.json({ error: 'profile_photo_count_limit' }, { status: 409 });
  }
  if (existing.reduce((total, photo) => total + photo.sizeBytes, 0) + bytes.byteLength > identityProfilePhotoLimits.maximumTotalBytes) {
    return Response.json({ error: 'profile_photo_storage_limit' }, { status: 409 });
  }

  const photoId = `pphoto_${crypto.randomUUID()}`;
  const safeUserId = user.userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const objectKey = `identity-profile-photos/${safeUserId}/${photoId}.vault`;
  const encryptedBytes = await encryptVaultBytes(bytes, identityProfilePhotoVaultContext(user.userId, photoId, 'bytes'));
  const now = new Date();
  const isPrimary = existing.length === 0 || makePrimary;
  const position = existing.reduce((maximum, photo) => Math.max(maximum, photo.position), -1) + 1;

  await getFilesBucket().put(objectKey, encryptedBytes, { httpMetadata: { contentType: 'application/octet-stream' } });
  try {
    const insert = getDb().insert(identityProfilePhotos).values({
      id: photoId,
      userId: user.userId,
      objectKey,
      contentType,
      sizeBytes: bytes.byteLength,
      category,
      position,
      isPrimary,
      captionCiphertext: caption ? await encryptVaultValue(caption, identityProfilePhotoVaultContext(user.userId, photoId, 'caption')) : null,
      createdAt: now,
      updatedAt: now,
    });
    if (isPrimary && existing.length > 0) {
      await getDb().batch([
        getDb().update(identityProfilePhotos).set({ isPrimary: false, updatedAt: now }).where(eq(identityProfilePhotos.userId, user.userId)),
        insert,
      ]);
    } else {
      await insert;
    }
  } catch {
    await getFilesBucket().delete(objectKey);
    return Response.json({ error: 'profile_photo_save_failed' }, { status: 500 });
  }

  const identity = await getIdentityProfilePayload(user.userId, user);
  return Response.json({ photos: identity.photos }, {
    status: 201,
    headers: { 'cache-control': 'private, no-store' },
  });
}
