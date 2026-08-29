import { getD1, getDb } from '@/db';
import { accountInvites, passwordAccounts } from '@/db/schema';
import {
  configuredAdminEmail,
  createPasswordSalt,
  createSessionCookie,
  hasSetupAccess,
  hashPassword,
  isSetupConfigured,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  PASSWORD_ITERATIONS,
  PERSONAL_USER_ID,
  verifySetupToken,
} from '@/app/personal-auth';
import { and, eq, gt } from 'drizzle-orm';
import { validateJsonMutation } from '@/lib/request-security';

type RegistrationBody = {
  email?: string;
  password?: string;
  setupToken?: string;
  inviteToken?: string;
};

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  if (!isSetupConfigured()) return Response.json({ error: 'auth_not_configured' }, { status: 503 });
  let body: RegistrationBody;
  try {
    body = (await request.json()) as RegistrationBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!isValidEmail(email)) return Response.json({ error: 'invalid_email' }, { status: 400 });
  if (!isValidPassword(password)) return Response.json({ error: 'invalid_password' }, { status: 400 });

  const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken : '';
  if (inviteToken) return registerInvitedUser(email, password, inviteToken);

  const existing = await getDb().select({ userId: passwordAccounts.userId }).from(passwordAccounts).limit(1);
  if (existing[0]) return Response.json({ error: 'invite_required' }, { status: 403 });

  const adminEmail = configuredAdminEmail();
  if (adminEmail && email !== adminEmail) return Response.json({ error: 'admin_email_required' }, { status: 403 });
  const setupToken = typeof body.setupToken === 'string' ? body.setupToken : '';
  // MATCHPILOT_ADMIN_EMAIL は「誰が管理者になれるか」の制約であり、初回登録の認可材料ではない。
  // isSetupConfigured() で MATCHPILOT_SETUP_SECRET の存在は保証済みのため、常にトークンまたは
  // セットアップCookieの所持を要求する。
  const setupAuthorized = verifySetupToken(setupToken) || await hasSetupAccess();
  if (!setupAuthorized) return Response.json({ error: 'invalid_setup_token' }, { status: 401 });

  const now = Date.now();
  const salt = createPasswordSalt();
  const passwordHash = await hashPassword(password, salt);
  const d1 = getD1();
  try {
    await d1.batch([
      d1.prepare(`INSERT INTO users
        (id, email, display_name, role, account_status, automation_state, created_at, updated_at)
        VALUES (?, ?, '管理者', 'admin', 'active', 'paused', ?, ?)
        ON CONFLICT(id) DO UPDATE SET email = excluded.email, role = 'admin', account_status = 'active', updated_at = excluded.updated_at`)
        .bind(PERSONAL_USER_ID, email, now, now),
      d1.prepare(`INSERT INTO password_accounts
        (user_id, email_normalized, password_hash, password_salt, password_iterations, session_version, last_login_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
        .bind(PERSONAL_USER_ID, email, passwordHash, salt, PASSWORD_ITERATIONS, now, now, now),
    ]);
  } catch {
    const account = await getDb().select({ userId: passwordAccounts.userId }).from(passwordAccounts).where(eq(passwordAccounts.userId, PERSONAL_USER_ID)).limit(1);
    return Response.json({ error: account[0] ? 'registration_closed' : 'registration_failed' }, { status: account[0] ? 409 : 500 });
  }

  return registrationResponse(PERSONAL_USER_ID, 1);
}

async function registerInvitedUser(email: string, password: string, inviteToken: string) {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(inviteToken)) return Response.json({ error: 'invalid_invite' }, { status: 401 });
  const now = new Date();
  const tokenHash = await sha256(inviteToken);
  const invites = await getDb()
    .select()
    .from(accountInvites)
    .where(and(
      eq(accountInvites.tokenHash, tokenHash),
      eq(accountInvites.status, 'pending'),
      gt(accountInvites.expiresAt, now),
    ))
    .limit(1);
  const invite = invites[0];
  if (!invite) return Response.json({ error: 'invalid_invite' }, { status: 401 });
  if (email !== invite.emailNormalized) return Response.json({ error: 'invite_email_mismatch' }, { status: 403 });

  const userId = `user_${crypto.randomUUID().replaceAll('-', '')}`;
  const timestamp = now.getTime();
  const salt = createPasswordSalt();
  const passwordHash = await hashPassword(password, salt);
  const displayName = email.split('@')[0].slice(0, 24) || 'ユーザー';
  const d1 = getD1();
  try {
    await d1.batch([
      d1.prepare(`UPDATE account_invites
        SET status = 'accepted', accepted_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending' AND expires_at > ?`)
        .bind(timestamp, timestamp, invite.id, timestamp),
      d1.prepare(`INSERT INTO users
        (id, email, display_name, role, account_status, automation_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', 'paused', ?, ?)`)
        .bind(userId, email, displayName, invite.role, timestamp, timestamp),
      d1.prepare(`INSERT INTO password_accounts
        (user_id, email_normalized, password_hash, password_salt, password_iterations, session_version, last_login_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
        .bind(userId, email, passwordHash, salt, PASSWORD_ITERATIONS, timestamp, timestamp, timestamp),
    ]);
  } catch {
    const existing = await getDb().select({ userId: passwordAccounts.userId }).from(passwordAccounts).where(eq(passwordAccounts.emailNormalized, email)).limit(1);
    return Response.json({ error: existing[0] ? 'email_in_use' : 'registration_failed' }, { status: existing[0] ? 409 : 500 });
  }

  return registrationResponse(userId, 1);
}

async function registrationResponse(userId: string, sessionVersion: number) {
  return Response.json({ ok: true }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
      'set-cookie': await createSessionCookie(userId, sessionVersion),
    },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
