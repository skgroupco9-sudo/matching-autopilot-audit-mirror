import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { serviceCredentials } from '@/db/schema';
import { getConnectorDefinition, serviceCatalogDefinitions } from '@/lib/automation/connectors';
import { getIdentityProfilePayload, serviceCredentialVaultContext } from '@/lib/identity-profile';
import { encryptVaultValue, isIdentityVaultConfigured } from '@/lib/identity-vault';
import { validateJsonMutation } from '@/lib/request-security';
import {
  createCustomServiceKey,
  normalizeCredentialLoginId,
  normalizeServiceKey,
  normalizeServiceLabel,
  serviceCredentialLimits,
  validServicePassword,
} from '@/lib/service-credentials';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const passwordServices = serviceCatalogDefinitions.map((service) => ({ id: service.id, label: service.label }));
const passwordServiceLabels = new Map(passwordServices.map((service) => [service.id, service.label]));

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const identity = await getIdentityProfilePayload(user.userId, user);
  return Response.json({ credentials: identity.credentials, limits: identity.credentialLimits }, {
    headers: { 'cache-control': 'private, no-store' },
  });
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

  const requestedKey = normalizeServiceKey(body.serviceKey);
  const customLabel = normalizeServiceLabel(body.customServiceLabel);
  const loginId = normalizeCredentialLoginId(body.loginId);
  const password = body.password;
  if (!validServicePassword(password, requestedKey)) return Response.json({ error: 'invalid_service_password' }, { status: 400 });

  const knownLabel = passwordServiceLabels.get(requestedKey);
  const serviceLabel = knownLabel ?? customLabel;
  const serviceKey = knownLabel
    ? requestedKey
    : customLabel ? await createCustomServiceKey(user.userId, customLabel) : '';
  if (!serviceKey || !serviceLabel) return Response.json({ error: 'invalid_service' }, { status: 400 });

  const connector = getConnectorDefinition(serviceKey);
  const registrationFillEnabled = body.registrationFillEnabled === true && connector?.supportStatus === 'assisted';
  const db = getDb();
  const existing = await db.select({ id: serviceCredentials.id }).from(serviceCredentials).where(and(
    eq(serviceCredentials.userId, user.userId),
    eq(serviceCredentials.serviceKey, serviceKey),
  )).limit(1);
  if (!existing[0]) {
    const count = await db.select({ id: serviceCredentials.id }).from(serviceCredentials).where(eq(serviceCredentials.userId, user.userId));
    if (count.length >= serviceCredentialLimits.maximumCount) {
      return Response.json({ error: 'service_credential_count_limit' }, { status: 409 });
    }
  }

  const credentialId = existing[0]?.id ?? `cred_${crypto.randomUUID()}`;
  const now = new Date();
  const values = {
    serviceLabelCiphertext: await encryptVaultValue(serviceLabel, serviceCredentialVaultContext(user.userId, credentialId, 'service_label')),
    loginIdCiphertext: loginId
      ? await encryptVaultValue(loginId, serviceCredentialVaultContext(user.userId, credentialId, 'login_id'))
      : null,
    passwordCiphertext: await encryptVaultValue(password, serviceCredentialVaultContext(user.userId, credentialId, 'password')),
    registrationFillEnabled,
    passwordUpdatedAt: now,
    updatedAt: now,
  };
  await db.insert(serviceCredentials).values({
    id: credentialId,
    userId: user.userId,
    serviceKey,
    ...values,
    createdAt: now,
  }).onConflictDoUpdate({
    target: [serviceCredentials.userId, serviceCredentials.serviceKey],
    set: values,
  });

  const identity = await getIdentityProfilePayload(user.userId, user);
  return Response.json({
    credential: identity.credentials.find((credential) => credential.id === credentialId),
    registrationFillAvailable: connector?.supportStatus === 'assisted',
  }, { status: existing[0] ? 200 : 201, headers: { 'cache-control': 'private, no-store' } });
}
