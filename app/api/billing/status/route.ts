import { getPersonalUser } from '@/app/personal-auth';
import { getBillingState } from '@/lib/billing-store';
import { isStripeBillingConfigured, isStripeBillingEnabled, stripePlanName } from '@/lib/stripe-billing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const billing = await getBillingState(user.userId);
  const subscription = billing.subscription;
  return Response.json({
    enabled: isStripeBillingEnabled(),
    configured: isStripeBillingConfigured(),
    planName: stripePlanName(),
    canManage: Boolean(billing.customer),
    subscription: subscription ? {
      status: subscription.status,
      active: ['active', 'trialing'].includes(subscription.status),
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      trialEnd: subscription.trialEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    } : null,
  }, { headers: { 'cache-control': 'private, no-store' } });
}
