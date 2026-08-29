import { getPersonalUser } from '@/app/personal-auth';
import { getD1 } from '@/db';
import { validateSameOriginMutation } from '@/lib/request-security';

export async function DELETE(request: Request, context: { params: Promise<{ inviteId: string }> }) {
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const admin = await getPersonalUser();
  if (!admin) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (admin.role !== 'admin') return Response.json({ error: 'admin_required' }, { status: 403 });
  const { inviteId } = await context.params;
  if (!/^invite_[A-Za-z0-9]{20,80}$/.test(inviteId)) return Response.json({ error: 'invalid_invite' }, { status: 400 });
  const result = await getD1().prepare(`
    UPDATE account_invites SET status = 'revoked', updated_at = ?
    WHERE id = ? AND status = 'pending'
    RETURNING id
  `).bind(Date.now(), inviteId).first<{ id: string }>();
  if (!result) return Response.json({ error: 'invite_not_found' }, { status: 404 });
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
