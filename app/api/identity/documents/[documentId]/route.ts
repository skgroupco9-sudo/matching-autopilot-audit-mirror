import { getPersonalUser } from '@/app/personal-auth';
import { getDb, getFilesBucket } from '@/db';
import { identityDocuments } from '@/db/schema';
import { identityDocumentExtension } from '@/lib/identity-documents';
import { identityDocumentVaultContext } from '@/lib/identity-profile';
import { decryptVaultBytes } from '@/lib/identity-vault';
import { validateSameOriginMutation } from '@/lib/request-security';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const { documentId } = await context.params;
  if (!validDocumentId(documentId)) return Response.json({ error: 'invalid_identity_document' }, { status: 400 });

  const rows = await getDb().select().from(identityDocuments).where(and(
    eq(identityDocuments.id, documentId),
    eq(identityDocuments.userId, authenticatedUser.userId),
  )).limit(1);
  const document = rows[0];
  if (!document) return Response.json({ error: 'identity_document_not_found' }, { status: 404 });

  const stored = await getFilesBucket().get(document.objectKey);
  if (!stored) return Response.json({ error: 'identity_document_file_missing' }, { status: 404 });
  try {
    const bytes = await decryptVaultBytes(
      await stored.arrayBuffer(),
      identityDocumentVaultContext(authenticatedUser.userId, document.id, 'bytes'),
    );
    const extension = identityDocumentExtension(document.contentType);
    return new Response(bytes, {
      headers: {
        'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="identity-document-${document.kind}-${document.side}.${extension}"`,
        'content-length': String(bytes.byteLength),
        'content-type': document.contentType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'identity_document_decryption_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const { documentId } = await context.params;
  if (!validDocumentId(documentId)) return Response.json({ error: 'invalid_identity_document' }, { status: 400 });

  const rows = await getDb().select({ objectKey: identityDocuments.objectKey }).from(identityDocuments).where(and(
    eq(identityDocuments.id, documentId),
    eq(identityDocuments.userId, authenticatedUser.userId),
  )).limit(1);
  if (!rows[0]) return Response.json({ error: 'identity_document_not_found' }, { status: 404 });

  await getFilesBucket().delete(rows[0].objectKey);
  await getDb().delete(identityDocuments).where(and(
    eq(identityDocuments.id, documentId),
    eq(identityDocuments.userId, authenticatedUser.userId),
  ));
  return Response.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}

function validDocumentId(documentId: string) {
  return /^idoc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(documentId);
}
