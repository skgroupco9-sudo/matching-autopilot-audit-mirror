import { getPersonalUser } from '@/app/personal-auth';
import { getBillingState } from '@/lib/billing-store';
import { createStripeCheckoutSession, isSafeStripeRedirect, isStripeBillingEnabled } from '@/lib/stripe-billing';
import { validateSameOriginMutation } from '@/lib/request-security';

const MANAGEABLE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']);

export async function POST(request: Request) {
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (!isStripeBillingEnabled()) return Response.json({ error: 'billing_not_enabled' }, { status: 503 });
  const billing = await getBillingState(user.userId);
  if (billing.subscription && MANAGEABLE_STATUSES.has(billing.subscription.status)) {
    return Response.json({ error: 'subscription_exists' }, { status: 409 });
  }
  try {
    const session = await createStripeCheckoutSession({
      userId: user.userId,
      email: user.email,
      customerId: billing.customer?.stripeCustomerId,
      origin: new URL(request.url).origin,
    });
    if (!isSafeStripeRedirect(session.url, 'checkout')) throw new Error('invalid_checkout_url');
    return Response.json({ url: session.url }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'checkout_creation_failed' }, { status: 502 });
  }
}
