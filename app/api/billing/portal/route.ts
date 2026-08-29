import { getPersonalUser } from '@/app/personal-auth';
import { getBillingState } from '@/lib/billing-store';
import { createStripePortalSession, isSafeStripeRedirect, isStripeApiConfigured } from '@/lib/stripe-billing';
import { validateSameOriginMutation } from '@/lib/request-security';

export async function POST(request: Request) {
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (!isStripeApiConfigured()) return Response.json({ error: 'billing_not_configured' }, { status: 503 });
  const billing = await getBillingState(user.userId);
  if (!billing.customer) return Response.json({ error: 'billing_customer_not_found' }, { status: 404 });
  try {
    const session = await createStripePortalSession(billing.customer.stripeCustomerId, new URL(request.url).origin);
    if (!isSafeStripeRedirect(session.url, 'portal')) throw new Error('invalid_portal_url');
    return Response.json({ url: session.url }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'portal_creation_failed' }, { status: 502 });
  }
}
