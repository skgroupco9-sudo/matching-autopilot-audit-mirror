import { getDb } from '@/db';
import { passwordAccounts } from '@/db/schema';
import { configuredAdminEmail, hasSetupAccess, isSessionConfigured, isSetupConfigured } from '@/app/personal-auth';

export async function GET() {
  const account = await getDb().select({ userId: passwordAccounts.userId }).from(passwordAccounts).limit(1);
  return Response.json({
    authConfigured: isSessionConfigured(),
    registrationOpen: isSetupConfigured() && !account[0],
    setupAuthorized: Boolean(configuredAdminEmail()) || await hasSetupAccess(),
  }, { headers: { 'cache-control': 'no-store' } });
}
