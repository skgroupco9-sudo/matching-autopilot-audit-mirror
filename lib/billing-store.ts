import { getDb } from '@/db';
import { billingCustomers, billingSubscriptions, users } from '@/db/schema';
import { stripeSubscriptionSnapshot } from '@/lib/stripe-billing';
import { eq } from 'drizzle-orm';

export async function getBillingState(userId: string) {
  const db = getDb();
  const [customers, subscriptions] = await Promise.all([
    db.select().from(billingCustomers).where(eq(billingCustomers.userId, userId)).limit(1),
    db.select().from(billingSubscriptions).where(eq(billingSubscriptions.userId, userId)).limit(1),
  ]);
  return { customer: customers[0] ?? null, subscription: subscriptions[0] ?? null };
}

export async function syncStripeSubscription(value: Record<string, unknown>, explicitUserId?: string | null) {
  const snapshot = stripeSubscriptionSnapshot(value);
  if (!snapshot) throw new Error('invalid_subscription_object');
  const userId = await resolveBillingUser(explicitUserId ?? snapshot.userId, snapshot.customerId);
  if (!userId) throw new Error('billing_user_not_found');
  const db = getDb();
  const now = new Date();
  await db.batch([
    db.insert(billingCustomers).values({
      userId,
      stripeCustomerId: snapshot.customerId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: billingCustomers.userId,
      set: { stripeCustomerId: snapshot.customerId, updatedAt: now },
    }),
    db.insert(billingSubscriptions).values({
      userId,
      stripeSubscriptionId: snapshot.id,
      stripePriceId: snapshot.priceId,
      status: snapshot.status,
      currentPeriodStart: snapshot.currentPeriodStart,
      currentPeriodEnd: snapshot.currentPeriodEnd,
      trialEnd: snapshot.trialEnd,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      canceledAt: snapshot.canceledAt,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: billingSubscriptions.userId,
      set: {
        stripeSubscriptionId: snapshot.id,
        stripePriceId: snapshot.priceId,
        status: snapshot.status,
        currentPeriodStart: snapshot.currentPeriodStart,
        currentPeriodEnd: snapshot.currentPeriodEnd,
        trialEnd: snapshot.trialEnd,
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        canceledAt: snapshot.canceledAt,
        updatedAt: now,
      },
    }),
  ]);
  return { userId, snapshot };
}

export async function saveStripeCustomer(userId: string, stripeCustomerId: string) {
  const now = new Date();
  await getDb().insert(billingCustomers).values({
    userId,
    stripeCustomerId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: billingCustomers.userId,
    set: { stripeCustomerId, updatedAt: now },
  });
}

async function resolveBillingUser(candidateUserId: string | null | undefined, stripeCustomerId: string) {
  const db = getDb();
  if (candidateUserId) {
    const matchedUser = await db.select({ id: users.id }).from(users).where(eq(users.id, candidateUserId)).limit(1);
    if (matchedUser[0]) return matchedUser[0].id;
  }
  const customer = await db.select({ userId: billingCustomers.userId }).from(billingCustomers).where(eq(billingCustomers.stripeCustomerId, stripeCustomerId)).limit(1);
  return customer[0]?.userId ?? null;
}
