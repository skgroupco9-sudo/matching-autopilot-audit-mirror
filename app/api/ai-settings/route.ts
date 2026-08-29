import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { aiCredentials } from '@/db/schema';
import { aiCredentialVaultContext, defaultOpenAiModel, normalizeOpenAiModel, openAiKeyHint, validOpenAiApiKey } from '@/lib/ai-credentials';
import { encryptVaultValue, isIdentityVaultConfigured } from '@/lib/identity-vault';
import { validateJsonMutation } from '@/lib/request-security';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const rows = await getDb().select({
    keyHint: aiCredentials.keyHint,
    model: aiCredentials.model,
    enabled: aiCredentials.enabled,
    updatedAt: aiCredentials.updatedAt,
  }).from(aiCredentials).where(eq(aiCredentials.userId, user.userId)).limit(1);
  const credential = rows[0];
  return Response.json({
    configured: Boolean(credential),
    enabled: credential?.enabled ?? false,
    keyHint: credential?.keyHint ?? null,
    model: credential?.model ?? defaultOpenAiModel,
    updatedAt: credential?.updatedAt.toISOString() ?? null,
  }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  if (!isIdentityVaultConfigured()) return Response.json({ error: 'identity_vault_not_configured' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!validOpenAiApiKey(body.apiKey)) return Response.json({ error: 'invalid_openai_api_key' }, { status: 400 });

  const now = new Date();
  const model = normalizeOpenAiModel(body.model);
  const values = {
    provider: 'openai' as const,
    apiKeyCiphertext: await encryptVaultValue(body.apiKey, aiCredentialVaultContext(user.userId)),
    keyHint: openAiKeyHint(body.apiKey),
    model,
    enabled: body.enabled !== false,
    updatedAt: now,
  };
  await getDb().insert(aiCredentials).values({
    userId: user.userId,
    ...values,
    createdAt: now,
  }).onConflictDoUpdate({
    target: aiCredentials.userId,
    set: values,
  });
  return Response.json({ configured: true, enabled: values.enabled, keyHint: values.keyHint, model, updatedAt: now.toISOString() }, {
    headers: { 'cache-control': 'private, no-store' },
  });
}

export async function DELETE(request: Request) {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  await getDb().delete(aiCredentials).where(eq(aiCredentials.userId, user.userId));
  return Response.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}
