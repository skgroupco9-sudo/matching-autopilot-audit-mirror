import { getPersonalUser, isValidEmail, normalizeEmail } from '@/app/personal-auth';
import { getD1 } from '@/db';
import { validateJsonMutation } from '@/lib/request-security';

export const dynamic = 'force-dynamic';

type InviteRow = {
  id: string;
  email_normalized: string;
  role: 'admin' | 'user';
  status: 'pending' | 'accepted' | 'revoked';
  expires_at: number;
  created_at: number;
};

export async function GET() {
  const admin = await getPersonalUser();
  if (!admin) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (admin.role !== 'admin') return Response.json({ error: 'admin_required' }, { status: 403 });
  const result = await getD1().prepare(`
    SELECT id, email_normalized, role, status, expires_at, created_at
    FROM account_invites
    WHERE status = 'pending' AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(Date.now()).all<InviteRow>();
  return Response.json({ invites: result.results.map((invite) => ({
    id: invite.id,
    email: invite.email_normalized,
    role: invite.role,
    status: invite.status,
    expiresAt: new Date(invite.expires_at).toISOString(),
    createdAt: new Date(invite.created_at).toISOString(),
  })) }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const admin = await getPersonalUser();
  if (!admin) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (admin.role !== 'admin') return Response.json({ error: 'admin_required' }, { status: 403 });
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!isValidEmail(email)) return Response.json({ error: 'invalid_email' }, { status: 400 });
  const existing = await getD1().prepare('SELECT user_id FROM password_accounts WHERE email_normalized = ?').bind(email).first();
  if (existing) return Response.json({ error: 'email_in_use' }, { status: 409 });

  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = Date.now();
  const expiresAt = now + 72 * 60 * 60 * 1000;
  const inviteId = `invite_${crypto.randomUUID().replaceAll('-', '')}`;
  await getD1().batch([
    getD1().prepare(`UPDATE account_invites SET status = 'revoked', updated_at = ? WHERE email_normalized = ? AND status = 'pending'`).bind(now, email),
    getD1().prepare(`INSERT INTO account_invites
      (id, email_normalized, role, token_hash, status, expires_at, accepted_at, created_by, created_at, updated_at)
      VALUES (?, ?, 'user', ?, 'pending', ?, NULL, ?, ?, ?)`)
      .bind(inviteId, email, tokenHash, expiresAt, admin.userId, now, now),
  ]);

  return Response.json({
    invite: {
      id: inviteId,
      email,
      role: 'user',
      expiresAt: new Date(expiresAt).toISOString(),
      path: `/#invite=${token}`,
    },
  }, { status: 201, headers: { 'cache-control': 'private, no-store' } });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
