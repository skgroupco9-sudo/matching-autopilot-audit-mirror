import { getDb } from '@/db';
import { stripeWebhookEvents } from '@/db/schema';
import { saveStripeCustomer, syncStripeSubscription } from '@/lib/billing-store';
import {
  checkoutSessionReferences,
  invoiceSubscriptionId,
  isStripeWebhookConfigured,
  parseStripeEvent,
  retrieveStripeSubscription,
  type StripeSnapshotEvent,
  verifyStripeWebhook,
} from '@/lib/stripe-billing';
import { eq } from 'drizzle-orm';

const MAX_WEBHOOK_BYTES = 1_000_000;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  if (!isStripeWebhookConfigured()) return Response.json({ error: 'webhook_not_configured' }, { status: 503 });
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) return Response.json({ error: 'payload_too_large' }, { status: 413 });
  const signature = request.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'missing_signature' }, { status: 400 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) return Response.json({ error: 'payload_too_large' }, { status: 413 });
  if (!await verifyStripeWebhook(rawBody, signature)) return Response.json({ error: 'invalid_signature' }, { status: 400 });
  const event = parseStripeEvent(rawBody);
  if (!event) return Response.json({ error: 'invalid_event' }, { status: 400 });

  const db = getDb();
  const now = new Date();
  const inserted = await db.insert(stripeWebhookEvents).values({
    eventId: event.id,
    type: event.type,
    status: 'processing',
    receivedAt: now,
  }).onConflictDoNothing().returning({ eventId: stripeWebhookEvents.eventId });

  if (!inserted[0]) {
    const existing = await db.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id)).limit(1);
    if (existing[0]?.status === 'processed') return Response.json({ received: true, duplicate: true });
    if (existing[0]?.status === 'processing' && now.getTime() - existing[0].receivedAt.getTime() < PROCESSING_TIMEOUT_MS) {
      return Response.json({ error: 'event_processing' }, { status: 409 });
    }
    await db.update(stripeWebhookEvents).set({
      status: 'processing',
      type: event.type,
      lastError: null,
      receivedAt: now,
      processedAt: null,
    }).where(eq(stripeWebhookEvents.eventId, event.id));
  }

  try {
    await processStripeEvent(event);
    await db.update(stripeWebhookEvents).set({ status: 'processed', processedAt: new Date(), lastError: null }).where(eq(stripeWebhookEvents.eventId, event.id));
    return Response.json({ received: true });
  } catch (error) {
    const lastError = error instanceof Error ? error.message.slice(0, 200) : 'stripe_event_processing_failed';
    await db.update(stripeWebhookEvents).set({ status: 'failed', processedAt: new Date(), lastError }).where(eq(stripeWebhookEvents.eventId, event.id));
    return Response.json({ error: 'event_processing_failed' }, { status: 500 });
  }
}

async function processStripeEvent(event: StripeSnapshotEvent) {
  const object = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const references = checkoutSessionReferences(object);
    if (!references.userId || !references.customerId || !references.subscriptionId) throw new Error('checkout_references_missing');
    await saveStripeCustomer(references.userId, references.customerId);
    const subscription = await retrieveStripeSubscription(references.subscriptionId);
    await syncStripeSubscription(subscription, references.userId);
    return;
  }

  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    await syncStripeSubscription(object);
    return;
  }

  if (['invoice.paid', 'invoice.payment_failed'].includes(event.type)) {
    const subscriptionId = invoiceSubscriptionId(object);
    if (!subscriptionId) return;
    const subscription = await retrieveStripeSubscription(subscriptionId);
    await syncStripeSubscription(subscription);
  }
}
