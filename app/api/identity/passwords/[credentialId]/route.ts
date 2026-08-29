import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { serviceCredentials } from '@/db/schema';
import { validateSameOriginMutation } from '@/lib/request-security';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request, context: { params: Promise<{ credentialId: string }> }) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const { credentialId } = await context.params;
  if (!validCredentialId(credentialId)) return Response.json({ error: 'invalid_service_credential' }, { status: 400 });

  const deleted = await getDb().delete(serviceCredentials).where(and(
    eq(serviceCredentials.id, credentialId),
    eq(serviceCredentials.userId, user.userId),
  )).returning({ id: serviceCredentials.id });
  if (!deleted[0]) return Response.json({ error: 'service_credential_not_found' }, { status: 404 });
  return Response.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}

export function validCredentialId(value: string) {
  return /^cred_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
