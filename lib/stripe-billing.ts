import { secretsEqual } from '@/lib/worker-auth';
import { env } from 'cloudflare:workers';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeSnapshotEvent = {
  id: string;
  type: string;
  created?: number;
  data: { object: Record<string, unknown> };
};

export type StripeSubscriptionSnapshot = {
  id: string;
  customerId: string;
  userId: string | null;
  priceId: string | null;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
};

export function isStripeBillingEnabled() {
  return env.STRIPE_BILLING_ENABLED === 'true'
    && isStripeBillingConfigured();
}

export function isStripeBillingConfigured() {
  return isStripeCheckoutConfigured() && isStripeWebhookConfigured();
}

export function isStripeApiConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function isStripeCheckoutConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}

export function isStripeWebhookConfigured() {
  return Boolean(env.STRIPE_WEBHOOK_SECRET);
}

export function stripePlanName() {
  return env.STRIPE_PLAN_NAME?.trim().slice(0, 80) || 'MatchPilot Pro';
}

export function stripePriceId() {
  return env.STRIPE_PRICE_ID?.trim() || null;
}

export async function createStripeCheckoutSession(input: {
  userId: string;
  email: string;
  origin: string;
  customerId?: string | null;
}) {
  const priceId = stripePriceId();
  if (!isStripeBillingEnabled() || !priceId) throw new Error('stripe_billing_not_enabled');
  const fields: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: input.userId,
    success_url: `${input.origin}/?billing=success`,
    cancel_url: `${input.origin}/?billing=cancelled`,
    'metadata[user_id]': input.userId,
    'subscription_data[metadata][user_id]': input.userId,
    locale: 'ja',
  };
  if (input.customerId) {
    fields.customer = input.customerId;
  } else {
    fields.customer_email = input.email;
  }
  return stripeRequest<{ id: string; url: string | null }>('/checkout/sessions', fields, `checkout-${input.userId}-${crypto.randomUUID()}`);
}

export async function createStripePortalSession(customerId: string, origin: string) {
  return stripeRequest<{ id: string; url: string }>('/billing_portal/sessions', {
    customer: customerId,
    return_url: `${origin}/?billing=portal_return`,
    locale: 'ja',
  }, `portal-${customerId}-${crypto.randomUUID()}`);
}

export async function retrieveStripeSubscription(subscriptionId: string) {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) throw new Error('invalid_subscription_id');
  return stripeRequest<Record<string, unknown>>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export async function cancelStripeSubscription(subscriptionId: string) {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) throw new Error('invalid_subscription_id');
  return stripeRequest<Record<string, unknown>>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    undefined,
    `account-delete-${subscriptionId}`,
    'DELETE',
  );
}

export async function verifyStripeWebhook(rawBody: string, signatureHeader: string) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;
  const parts = signatureHeader.split(',').map((part) => part.trim().split('=', 2));
  const timestampText = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key, value]) => key === 'v1' && value).map(([, value]) => value);
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return signatures.some((signature) => secretsEqual(signature.toLowerCase(), expected));
}

export function parseStripeEvent(rawBody: string): StripeSnapshotEvent | null {
  try {
    const event = JSON.parse(rawBody) as unknown;
    if (!isRecord(event) || typeof event.id !== 'string' || !event.id.startsWith('evt_') || typeof event.type !== 'string') return null;
    if (!isRecord(event.data) || !isRecord(event.data.object)) return null;
    return {
      id: event.id,
      type: event.type,
      created: numberField(event.created) ?? undefined,
      data: { object: event.data.object },
    };
  } catch {
    return null;
  }
}

export function stripeSubscriptionSnapshot(value: Record<string, unknown>): StripeSubscriptionSnapshot | null {
  const id = stringField(value.id);
  const customerId = stripeId(value.customer, 'cus_');
  const status = stringField(value.status);
  if (!id?.startsWith('sub_') || !customerId || !status) return null;
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const items = isRecord(value.items) && Array.isArray(value.items.data) ? value.items.data : [];
  const firstItem = isRecord(items[0]) ? items[0] : {};
  const price = isRecord(firstItem.price) ? firstItem.price : {};
  return {
    id,
    customerId,
    userId: stringField(metadata.user_id),
    priceId: stringField(price.id),
    status,
    currentPeriodStart: unixDate(numberField(value.current_period_start) ?? numberField(firstItem.current_period_start)),
    currentPeriodEnd: unixDate(numberField(value.current_period_end) ?? numberField(firstItem.current_period_end)),
    trialEnd: unixDate(numberField(value.trial_end)),
    cancelAtPeriodEnd: value.cancel_at_period_end === true,
    canceledAt: unixDate(numberField(value.canceled_at)),
  };
}

export function stripeId(value: unknown, prefix: string) {
  if (typeof value === 'string' && value.startsWith(prefix)) return value;
  if (isRecord(value) && typeof value.id === 'string' && value.id.startsWith(prefix)) return value.id;
  return null;
}

export function invoiceSubscriptionId(invoice: Record<string, unknown>) {
  const legacy = stripeId(invoice.subscription, 'sub_');
  if (legacy) return legacy;
  const parent = isRecord(invoice.parent) ? invoice.parent : {};
  const details = isRecord(parent.subscription_details) ? parent.subscription_details : {};
  return stripeId(details.subscription, 'sub_');
}

export function checkoutSessionReferences(session: Record<string, unknown>) {
  const metadata = isRecord(session.metadata) ? session.metadata : {};
  return {
    userId: stringField(session.client_reference_id) ?? stringField(metadata.user_id),
    customerId: stripeId(session.customer, 'cus_'),
    subscriptionId: stripeId(session.subscription, 'sub_'),
  };
}

export function isSafeStripeRedirect(url: string | null | undefined, kind: 'checkout' | 'portal') {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (kind === 'checkout' ? parsed.hostname === 'checkout.stripe.com' : parsed.hostname === 'billing.stripe.com');
  } catch {
    return false;
  }
}

async function stripeRequest<T>(path: string, fields?: Record<string, string>, idempotencyKey?: string, method?: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('stripe_secret_not_configured');
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
  };
  if (fields) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const response = await fetchWithTimeout(`${STRIPE_API_BASE}${path}`, {
    method: method ?? (fields ? 'POST' : 'GET'),
    headers,
    body: fields ? new URLSearchParams(fields).toString() : undefined,
  });
  if (!response.ok) throw new Error(`stripe_api_error_${response.status}`);
  return response.json() as Promise<T>;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unixDate(value: number | null) {
  return value && value > 0 ? new Date(value * 1000) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
