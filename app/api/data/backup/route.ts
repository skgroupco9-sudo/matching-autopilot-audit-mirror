import { getPersonalUser } from '@/app/personal-auth';
import { createEncryptedAccountBackup } from '@/lib/account-backup';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { validateSameOriginMutation } from '@/lib/request-security';
import { eq } from 'drizzle-orm';

export async function GET() {
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const rows = await getDb().select({ lastBackupAt: users.lastBackupAt }).from(users).where(eq(users.id, user.userId)).limit(1);
  return Response.json({ lastBackupAt: rows[0]?.lastBackupAt?.toISOString() ?? null, retentionCount: 7 }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  try {
    const result = await createEncryptedAccountBackup(user.userId);
    return Response.json({ ok: true, created: result.created, lastBackupAt: new Date().toISOString() });
  } catch {
    return Response.json({ error: 'backup_failed' }, { status: 500 });
  }
}
