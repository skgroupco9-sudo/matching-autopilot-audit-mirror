import { getDb } from '@/db';
import { aiCredentials } from '@/db/schema';
import { aiCredentialVaultContext } from '@/lib/ai-credentials';
import { decryptVaultValue } from '@/lib/identity-vault';
import { isKnownWorkerForUser } from '@/lib/worker-user-access';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('user_id') ?? '';
  if (!await isKnownWorkerForUser(request, userId)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const rows = await getDb().select({
    apiKeyCiphertext: aiCredentials.apiKeyCiphertext,
    model: aiCredentials.model,
    enabled: aiCredentials.enabled,
  }).from(aiCredentials).where(eq(aiCredentials.userId, userId)).limit(1);
  const credential = rows[0];
  if (!credential || !credential.enabled) {
    return Response.json({ configured: false, enabled: false }, { headers: { 'cache-control': 'private, no-store' } });
  }
  try {
    return Response.json({
      configured: true,
      enabled: true,
      apiKey: await decryptVaultValue(credential.apiKeyCiphertext, aiCredentialVaultContext(userId)),
      model: credential.model,
    }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'ai_credential_load_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
