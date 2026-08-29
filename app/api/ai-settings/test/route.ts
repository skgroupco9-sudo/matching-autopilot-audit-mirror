import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { aiCredentials } from '@/db/schema';
import { aiCredentialVaultContext } from '@/lib/ai-credentials';
import { decryptVaultValue, isIdentityVaultConfigured } from '@/lib/identity-vault';
import { probeOpenAiConnection } from '@/lib/openai-connection';
import { validateJsonMutation } from '@/lib/request-security';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  if (!isIdentityVaultConfigured()) return Response.json({ error: 'identity_vault_not_configured' }, { status: 503 });

  const rows = await getDb().select({
    apiKeyCiphertext: aiCredentials.apiKeyCiphertext,
    model: aiCredentials.model,
    enabled: aiCredentials.enabled,
  }).from(aiCredentials).where(eq(aiCredentials.userId, user.userId)).limit(1);
  const credential = rows[0];
  if (!credential || !credential.enabled) return Response.json({ error: 'ai_not_configured' }, { status: 400 });

  try {
    const apiKey = await decryptVaultValue(credential.apiKeyCiphertext, aiCredentialVaultContext(user.userId));
    const probe = await probeOpenAiConnection(apiKey, credential.model);
    return Response.json(probe, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'ai_credential_unavailable' }, { status: 503 });
  }
}
