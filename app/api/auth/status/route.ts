import { getDb } from '@/db';
import { passwordAccounts } from '@/db/schema';
import { hasSetupAccess, isSessionConfigured, isSetupConfigured } from '@/app/personal-auth';

export async function GET() {
  const account = await getDb().select({ userId: passwordAccounts.userId }).from(passwordAccounts).limit(1);
  return Response.json({
    authConfigured: isSessionConfigured(),
    registrationOpen: isSetupConfigured() && !account[0],
    setupAuthorized: await hasSetupAccess(),
  }, { headers: { 'cache-control': 'no-store' } });
}
