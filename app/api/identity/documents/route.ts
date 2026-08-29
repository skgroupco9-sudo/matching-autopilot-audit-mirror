import { getPersonalUser } from '@/app/personal-auth';
import { getDb, getFilesBucket } from '@/db';
import { identityDocuments } from '@/db/schema';
import {
  detectIdentityDocumentContentType,
  identityDocumentLimits,
  isAllowedIdentityDocumentSide,
  normalizeIdentityDocumentExpiry,
  normalizeIdentityDocumentKind,
  normalizeIdentityDocumentSide,
} from '@/lib/identity-documents';
import { getIdentityProfilePayload, identityDocumentVaultContext } from '@/lib/identity-profile';
import { encryptVaultBytes, encryptVaultValue, isIdentityVaultConfigured } from '@/lib/identity-vault';
import { validateMultipartMutation } from '@/lib/request-security';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const payload = await getIdentityProfilePayload(authenticatedUser.userId, authenticatedUser);
  return Response.json({ documents: payload.documents, limits: payload.documentLimits }, {
    headers: { 'cache-control': 'private, no-store' },
  });
}

export async function POST(request: Request) {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateMultipartMutation(request);
  if (requestError) return requestError;
  if (!isIdentityVaultConfigured()) return Response.json({ error: 'identity_vault_not_configured' }, { status: 503 });

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > identityDocumentLimits.maximumFileBytes + 1024 * 1024) {
    return Response.json({ error: 'identity_document_too_large' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'invalid_form_data' }, { status: 400 });
  }

  const file = formData.get('file');
  const kind = normalizeIdentityDocumentKind(formData.get('kind'));
  const side = normalizeIdentityDocumentSide(formData.get('side'));
  const expiresOn = normalizeIdentityDocumentExpiry(formData.get('expiresOn'));
  if (!(file instanceof File) || !kind || !side || expiresOn == null || formData.get('consent') !== 'true') {
    return Response.json({ error: 'invalid_identity_document_metadata' }, { status: 400 });
  }
  if (!isAllowedIdentityDocumentSide(kind, side)) {
    return Response.json({ error: 'identity_document_sensitive_side_rejected' }, { status: 400 });
  }
  if (file.size <= 0 || file.size > identityDocumentLimits.maximumFileBytes) {
    return Response.json({ error: 'identity_document_too_large' }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectIdentityDocumentContentType(bytes);
  if (!contentType) return Response.json({ error: 'unsupported_identity_document_type' }, { status: 415 });

  const existing = await getDb()
    .select({ id: identityDocuments.id, sizeBytes: identityDocuments.sizeBytes })
    .from(identityDocuments)
    .where(eq(identityDocuments.userId, authenticatedUser.userId));
  const usedBytes = existing.reduce((total, document) => total + document.sizeBytes, 0);
  if (existing.length >= identityDocumentLimits.maximumCount) {
    return Response.json({ error: 'identity_document_count_limit' }, { status: 409 });
  }
  if (usedBytes + bytes.byteLength > identityDocumentLimits.maximumTotalBytes) {
    return Response.json({ error: 'identity_document_storage_limit' }, { status: 409 });
  }

  const documentId = `idoc_${crypto.randomUUID()}`;
  const safeUserId = authenticatedUser.userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const objectKey = `identity-documents/${safeUserId}/${documentId}.vault`;
  const encryptedBytes = await encryptVaultBytes(bytes, identityDocumentVaultContext(authenticatedUser.userId, documentId, 'bytes'));
  const now = new Date();

  await getFilesBucket().put(objectKey, encryptedBytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  try {
    await getDb().insert(identityDocuments).values({
      id: documentId,
      userId: authenticatedUser.userId,
      kind,
      side,
      objectKey,
      contentType,
      sizeBytes: bytes.byteLength,
      expiresOnCiphertext: expiresOn
        ? await encryptVaultValue(expiresOn, identityDocumentVaultContext(authenticatedUser.userId, documentId, 'expires_on'))
        : null,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    await getFilesBucket().delete(objectKey);
    return Response.json({ error: 'identity_document_save_failed' }, { status: 500 });
  }

  const payload = await getIdentityProfilePayload(authenticatedUser.userId, authenticatedUser);
  return Response.json({ document: payload.documents.find((document) => document.id === documentId) }, {
    status: 201,
    headers: { 'cache-control': 'private, no-store' },
  });
}
