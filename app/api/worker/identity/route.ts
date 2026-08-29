import { getIdentityProfilePayload, serviceCredentialVaultContext } from '@/lib/identity-profile';
import { getDb } from '@/db';
import { serviceCredentials } from '@/db/schema';
import { decryptVaultValue } from '@/lib/identity-vault';
import { isKnownWorkerForUser } from '@/lib/worker-user-access';
import { and, eq } from 'drizzle-orm';
import { toWorkerRegistrationProfile } from '@/lib/worker-identity-profile';

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('user_id') ?? '';
  const provider = new URL(request.url).searchParams.get('provider') ?? '';
  if (!await isKnownWorkerForUser(request, userId)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const identity = await getIdentityProfilePayload(userId, { email: '', displayName: '' });
    if (!identity.profile.registrationAssistEnabled) return Response.json({ error: 'registration_assist_disabled' }, { status: 409 });
    const credentialRows = /^[a-z0-9][a-z0-9-]{0,63}$/.test(provider)
      ? await getDb().select().from(serviceCredentials).where(and(
        eq(serviceCredentials.userId, userId),
        eq(serviceCredentials.serviceKey, provider),
        eq(serviceCredentials.registrationFillEnabled, true),
      )).limit(1)
      : [];
    const credential = credentialRows[0]
      ? {
        loginId: await decryptVaultValue(credentialRows[0].loginIdCiphertext, serviceCredentialVaultContext(userId, credentialRows[0].id, 'login_id')),
        password: await decryptVaultValue(credentialRows[0].passwordCiphertext, serviceCredentialVaultContext(userId, credentialRows[0].id, 'password')),
      }
      : null;
    const primaryPhoto = identity.photos.find((photo) => photo.isPrimary) ?? null;
    return Response.json({
      profile: toWorkerRegistrationProfile(identity.profile),
      primaryPhoto: primaryPhoto
        ? {
          id: primaryPhoto.id,
          contentType: primaryPhoto.contentType,
          sizeBytes: primaryPhoto.sizeBytes,
        }
        : null,
      gmailCodeAssistEnabled: identity.profile.gmailCodeAssistEnabled && identity.gmail.connected,
      credential,
    }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'identity_profile_load_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
