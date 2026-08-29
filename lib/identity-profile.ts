import { getDb } from '@/db';
import { gmailConnections, identityDocuments, identityProfilePhotos, identityProfiles, serviceCredentials } from '@/db/schema';
import { decryptVaultValue, isIdentityVaultConfigured } from '@/lib/identity-vault';
import { isGoogleGmailConfigured } from '@/lib/google-gmail';
import type { IdentityProfilePayload } from '@/lib/identity-types';
import { identityDocumentLimits, isExpiredIdentityDocument } from '@/lib/identity-documents';
import { emptyExtendedIdentityProfile, parseExtendedIdentityProfile } from '@/lib/identity-profile-fields';
import { identityProfilePhotoLimits } from '@/lib/identity-profile-photos';
import { maskCredentialLoginId, serviceCredentialLimits } from '@/lib/service-credentials';
import { desc, eq } from 'drizzle-orm';

export async function getIdentityProfilePayload(userId: string, fallback: { email: string; displayName: string }): Promise<IdentityProfilePayload> {
  const vaultConfigured = isIdentityVaultConfigured();
  const [profileRows, gmailRows, documentRows, photoRows, credentialRows] = await Promise.all([
    getDb().select().from(identityProfiles).where(eq(identityProfiles.userId, userId)).limit(1),
    getDb().select().from(gmailConnections).where(eq(gmailConnections.userId, userId)).limit(1),
    getDb().select().from(identityDocuments).where(eq(identityDocuments.userId, userId)).orderBy(desc(identityDocuments.createdAt)),
    getDb().select().from(identityProfilePhotos).where(eq(identityProfilePhotos.userId, userId)).orderBy(identityProfilePhotos.position, identityProfilePhotos.createdAt),
    getDb().select().from(serviceCredentials).where(eq(serviceCredentials.userId, userId)).orderBy(desc(serviceCredentials.updatedAt)),
  ]);
  const profile = profileRows[0];
  const gmail = gmailRows[0];
  if (!vaultConfigured) {
    return {
      vaultConfigured: false,
      profile: emptyProfile(fallback),
      gmail: { oauthConfigured: isGoogleGmailConfigured(), connected: false, email: '', status: 'not_connected', lastSyncedAt: null },
      documents: [],
      photos: [],
      documentLimits: identityDocumentLimits,
      photoLimits: identityProfilePhotoLimits,
      credentials: [],
      credentialLimits: serviceCredentialLimits,
    };
  }

  const documents = await Promise.all(documentRows.map(async (document) => {
    const expiresOn = await decryptVaultValue(document.expiresOnCiphertext, identityDocumentVaultContext(userId, document.id, 'expires_on'));
    return {
      id: document.id,
      kind: document.kind,
      side: document.side,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      expiresOn,
      expired: isExpiredIdentityDocument(expiresOn),
      createdAt: document.createdAt.toISOString(),
      downloadUrl: `/api/identity/documents/${encodeURIComponent(document.id)}`,
    };
  }));

  const photos = await Promise.all(photoRows.map(async (photo) => ({
    id: photo.id,
    contentType: photo.contentType,
    sizeBytes: photo.sizeBytes,
    category: photo.category,
    position: photo.position,
    isPrimary: photo.isPrimary,
    caption: await decryptVaultValue(photo.captionCiphertext, identityProfilePhotoVaultContext(userId, photo.id, 'caption')),
    createdAt: photo.createdAt.toISOString(),
    updatedAt: photo.updatedAt.toISOString(),
    previewUrl: `/api/identity/photos/${encodeURIComponent(photo.id)}?v=${photo.updatedAt.getTime()}`,
  })));

  const extendedProfile = parseExtendedIdentityProfile(await decryptVaultValue(
    profile?.extendedProfileCiphertext ?? null,
    context(userId, 'extended_profile'),
  ));

  const credentials = await Promise.all(credentialRows.map(async (credential) => {
    const serviceLabel = await decryptVaultValue(
      credential.serviceLabelCiphertext,
      serviceCredentialVaultContext(userId, credential.id, 'service_label'),
    );
    const loginId = await decryptVaultValue(
      credential.loginIdCiphertext,
      serviceCredentialVaultContext(userId, credential.id, 'login_id'),
    );
    return {
      id: credential.id,
      serviceKey: credential.serviceKey,
      serviceLabel,
      loginHint: maskCredentialLoginId(loginId),
      registrationFillEnabled: credential.registrationFillEnabled,
      passwordUpdatedAt: credential.passwordUpdatedAt.toISOString(),
      createdAt: credential.createdAt.toISOString(),
      updatedAt: credential.updatedAt.toISOString(),
    };
  }));

  return {
    vaultConfigured: true,
    profile: {
      ...extendedProfile,
      registrationEmail: await decryptVaultValue(profile?.registrationEmailCiphertext ?? null, context(userId, 'registration_email')) || fallback.email,
      phoneNumber: await decryptVaultValue(profile?.phoneNumberCiphertext ?? null, context(userId, 'phone_number')),
      nickname: await decryptVaultValue(profile?.nicknameCiphertext ?? null, context(userId, 'nickname')) || fallback.displayName,
      birthDate: await decryptVaultValue(profile?.birthDateCiphertext ?? null, context(userId, 'birth_date')),
      gender: await decryptVaultValue(profile?.genderCiphertext ?? null, context(userId, 'gender')),
      residence: await decryptVaultValue(profile?.residenceCiphertext ?? null, context(userId, 'residence')),
      occupation: await decryptVaultValue(profile?.occupationCiphertext ?? null, context(userId, 'occupation')),
      bio: await decryptVaultValue(profile?.bioCiphertext ?? null, context(userId, 'bio')),
      phoneOwnershipConfirmed: profile?.phoneOwnershipConfirmed ?? false,
      registrationAssistEnabled: profile?.registrationAssistEnabled ?? false,
      gmailCodeAssistEnabled: profile?.gmailCodeAssistEnabled ?? false,
      updatedAt: profile?.updatedAt.toISOString() ?? null,
    },
    gmail: {
      oauthConfigured: isGoogleGmailConfigured(),
      connected: gmail?.status === 'connected',
      email: gmail ? await decryptVaultValue(gmail.emailCiphertext, context(userId, 'gmail_email')) : '',
      status: gmail?.status ?? 'not_connected',
      lastSyncedAt: gmail?.lastSyncedAt?.toISOString() ?? null,
    },
    documents,
    photos,
    documentLimits: identityDocumentLimits,
    photoLimits: identityProfilePhotoLimits,
    credentials,
    credentialLimits: serviceCredentialLimits,
  };
}

export function identityVaultContext(userId: string, field: string) {
  return context(userId, field);
}

export function identityDocumentVaultContext(userId: string, documentId: string, field: 'bytes' | 'expires_on') {
  return context(userId, `identity_document:${documentId}:${field}`);
}

export function identityProfilePhotoVaultContext(userId: string, photoId: string, field: 'bytes' | 'caption') {
  return context(userId, `identity_profile_photo:${photoId}:${field}`);
}

export function serviceCredentialVaultContext(userId: string, credentialId: string, field: 'service_label' | 'login_id' | 'password') {
  return context(userId, `service_credential:${credentialId}:${field}`);
}

function context(userId: string, field: string) {
  return `matchpilot:${userId}:${field}`;
}

function emptyProfile(fallback: { email: string; displayName: string }): IdentityProfilePayload['profile'] {
  return {
    ...emptyExtendedIdentityProfile,
    registrationEmail: fallback.email,
    phoneNumber: '',
    nickname: fallback.displayName,
    birthDate: '',
    gender: '',
    residence: '',
    occupation: '',
    bio: '',
    phoneOwnershipConfirmed: false,
    registrationAssistEnabled: false,
    gmailCodeAssistEnabled: false,
    updatedAt: null,
  };
}
