import { getPersonalUser, isValidEmail, normalizeEmail } from '@/app/personal-auth';
import { getDb } from '@/db';
import { automationJobs, identityProfiles } from '@/db/schema';
import { getIdentityProfilePayload, identityVaultContext } from '@/lib/identity-profile';
import { encryptVaultValue, isIdentityVaultConfigured } from '@/lib/identity-vault';
import { normalizeExtendedIdentityProfile } from '@/lib/identity-profile-fields';
import { validateJsonMutation } from '@/lib/request-security';
import { normalizeUnicodeText } from '@/lib/unicode-text';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  try {
    return Response.json(await getIdentityProfilePayload(authenticatedUser.userId, authenticatedUser), {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch {
    return Response.json({ error: 'identity_profile_load_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

export async function PUT(request: Request) {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  if (!isIdentityVaultConfigured()) return Response.json({ error: 'identity_vault_not_configured' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const registrationEmail = normalizeEmail(normalizeText(body.registrationEmail, 254));
  const phoneNumber = normalizePhoneNumber(normalizeText(body.phoneNumber, 30));
  const nickname = normalizeText(body.nickname, 40);
  const birthDate = normalizeText(body.birthDate, 10);
  const gender = normalizeText(body.gender, 30);
  const residence = normalizeText(body.residence, 60);
  const occupation = normalizeText(body.occupation, 80);
  const bio = normalizeText(body.bio, 1000);
  const phoneOwnershipConfirmed = body.phoneOwnershipConfirmed === true;
  const registrationAssistEnabled = body.registrationAssistEnabled === true;
  const gmailCodeAssistEnabled = body.gmailCodeAssistEnabled === true;
  const extendedProfile = normalizeExtendedIdentityProfile(body);

  if (!registrationEmail || !isValidEmail(registrationEmail)) return invalid('invalid_registration_email');
  if (body.phoneNumber && !phoneNumber) return invalid('invalid_phone_number');
  if (!nickname) return invalid('invalid_nickname');
  if (birthDate && !isAdultBirthDate(birthDate)) return invalid('adult_birth_date_required');
  if (gender && !['male', 'female', 'non_binary', 'other', 'prefer_not_to_say'].includes(gender)) return invalid('invalid_gender');
  if (phoneOwnershipConfirmed && !phoneNumber) return invalid('phone_number_required');
  if (!extendedProfile.ok) return invalid(extendedProfile.error);

  const userId = authenticatedUser.userId;
  const now = new Date();
  try {
    await getDb().batch([
      getDb().insert(identityProfiles).values({
        userId,
        registrationEmailCiphertext: await encryptVaultValue(registrationEmail, identityVaultContext(userId, 'registration_email')),
        phoneNumberCiphertext: phoneNumber ? await encryptVaultValue(phoneNumber, identityVaultContext(userId, 'phone_number')) : null,
        nicknameCiphertext: await encryptVaultValue(nickname, identityVaultContext(userId, 'nickname')),
        birthDateCiphertext: birthDate ? await encryptVaultValue(birthDate, identityVaultContext(userId, 'birth_date')) : null,
        genderCiphertext: gender ? await encryptVaultValue(gender, identityVaultContext(userId, 'gender')) : null,
        residenceCiphertext: residence ? await encryptVaultValue(residence, identityVaultContext(userId, 'residence')) : null,
        occupationCiphertext: occupation ? await encryptVaultValue(occupation, identityVaultContext(userId, 'occupation')) : null,
        bioCiphertext: bio ? await encryptVaultValue(bio, identityVaultContext(userId, 'bio')) : null,
        extendedProfileCiphertext: await encryptVaultValue(JSON.stringify(extendedProfile.value), identityVaultContext(userId, 'extended_profile')),
        phoneOwnershipConfirmed,
        registrationAssistEnabled,
        gmailCodeAssistEnabled,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: identityProfiles.userId,
        set: {
          registrationEmailCiphertext: await encryptVaultValue(registrationEmail, identityVaultContext(userId, 'registration_email')),
          phoneNumberCiphertext: phoneNumber ? await encryptVaultValue(phoneNumber, identityVaultContext(userId, 'phone_number')) : null,
          nicknameCiphertext: await encryptVaultValue(nickname, identityVaultContext(userId, 'nickname')),
          birthDateCiphertext: birthDate ? await encryptVaultValue(birthDate, identityVaultContext(userId, 'birth_date')) : null,
          genderCiphertext: gender ? await encryptVaultValue(gender, identityVaultContext(userId, 'gender')) : null,
          residenceCiphertext: residence ? await encryptVaultValue(residence, identityVaultContext(userId, 'residence')) : null,
          occupationCiphertext: occupation ? await encryptVaultValue(occupation, identityVaultContext(userId, 'occupation')) : null,
          bioCiphertext: bio ? await encryptVaultValue(bio, identityVaultContext(userId, 'bio')) : null,
          extendedProfileCiphertext: await encryptVaultValue(JSON.stringify(extendedProfile.value), identityVaultContext(userId, 'extended_profile')),
          phoneOwnershipConfirmed,
          registrationAssistEnabled,
          gmailCodeAssistEnabled,
          updatedAt: now,
        },
      }),
      getDb().insert(automationJobs).values({
        id: `identity_${crypto.randomUUID()}`,
        userId,
        connectionId: null,
        type: 'identity_profile_updated',
        payloadJson: JSON.stringify({ registrationAssistEnabled, gmailCodeAssistEnabled, phoneReady: Boolean(phoneNumber && phoneOwnershipConfirmed) }),
        status: 'completed',
        priority: 100,
        attempts: 1,
        runAfter: now,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    return Response.json({ ok: true, profile: await getIdentityProfilePayload(userId, authenticatedUser) }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'identity_profile_save_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

function normalizeText(value: unknown, maximumLength: number) {
  return normalizeUnicodeText(value, maximumLength);
}

function normalizePhoneNumber(value: string) {
  if (!value) return '';
  const compact = value.replace(/[\s()-]/g, '');
  const international = compact.startsWith('0') ? `+81${compact.slice(1)}` : compact;
  return /^\+[1-9][0-9]{7,14}$/.test(international) ? international : '';
}

function isAdultBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const birthDate = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime()) || birthDate.toISOString().slice(0, 10) !== value) return false;
  const today = new Date();
  const adultThreshold = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  const oldestThreshold = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()));
  return birthDate <= adultThreshold && birthDate >= oldestThreshold;
}

function invalid(error: string) {
  return Response.json({ error }, { status: 400 });
}
