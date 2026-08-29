import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { serviceCredentials } from '@/db/schema';
import { connectorDefinitions } from '@/lib/automation/connectors';
import { getIdentityProfilePayload, serviceCredentialVaultContext } from '@/lib/identity-profile';
import { encryptVaultValue, isIdentityVaultConfigured } from '@/lib/identity-vault';
import { validateSameOriginMutation } from '@/lib/request-security';
import { generateServicePassword } from '@/lib/service-password-generation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (!isIdentityVaultConfigured()) return Response.json({ error: 'identity_vault_not_configured' }, { status: 503 });

  const identity = await getIdentityProfilePayload(user.userId, user);
  const existingServiceKeys = new Set(identity.credentials.map((credential) => credential.serviceKey));
  const availableSlots = identity.credentialLimits.maximumCount - identity.credentials.length;
  const targets = connectorDefinitions
    .filter((connector) => connector.supportStatus === 'assisted' && !existingServiceKeys.has(connector.id))
    .slice(0, Math.max(0, availableSlots));
  const now = new Date();
  const db = getDb();

  for (const connector of targets) {
    const credentialId = `cred_${crypto.randomUUID()}`;
    const password = generateServicePassword(connector.id);
    await db.insert(serviceCredentials).values({
      id: credentialId,
      userId: user.userId,
      serviceKey: connector.id,
      serviceLabelCiphertext: await encryptVaultValue(connector.label, serviceCredentialVaultContext(user.userId, credentialId, 'service_label')),
      loginIdCiphertext: await encryptVaultValue(identity.profile.registrationEmail, serviceCredentialVaultContext(user.userId, credentialId, 'login_id')),
      passwordCiphertext: await encryptVaultValue(password, serviceCredentialVaultContext(user.userId, credentialId, 'password')),
      registrationFillEnabled: true,
      passwordUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
  }

  const refreshed = await getIdentityProfilePayload(user.userId, user);
  return Response.json({
    ok: true,
    created: targets.length,
    skipped: existingServiceKeys.size,
    credentials: refreshed.credentials,
  }, { status: targets.length ? 201 : 200, headers: { 'cache-control': 'private, no-store' } });
}
