import { getPersonalUser } from '@/app/personal-auth';
import { getD1 } from '@/db';
import { validateJsonMutation } from '@/lib/request-security';

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const admin = await getPersonalUser();
  if (!admin) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (admin.role !== 'admin') return Response.json({ error: 'admin_required' }, { status: 403 });
  const { userId } = await context.params;
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(userId)) return Response.json({ error: 'invalid_user' }, { status: 400 });
  if (userId === admin.userId) return Response.json({ error: 'cannot_change_own_status' }, { status: 409 });

  let body: { status?: string };
  try {
    body = (await request.json()) as { status?: string };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (body.status !== 'active' && body.status !== 'suspended') return Response.json({ error: 'invalid_status' }, { status: 400 });

  const target = await getD1().prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ id: string; role: string }>();
  if (!target) return Response.json({ error: 'account_not_found' }, { status: 404 });
  if (target.role === 'admin') return Response.json({ error: 'cannot_change_admin_status' }, { status: 409 });

  const now = Date.now();
  await getD1().batch([
    getD1().prepare('UPDATE users SET account_status = ?, updated_at = ? WHERE id = ?').bind(body.status, now, userId),
    getD1().prepare('UPDATE password_accounts SET session_version = session_version + 1, updated_at = ? WHERE user_id = ?').bind(now, userId),
  ]);
  return Response.json({ ok: true, status: body.status }, { headers: { 'cache-control': 'no-store' } });
}
