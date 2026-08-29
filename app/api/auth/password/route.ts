import {
  createPasswordSalt,
  createSessionCookie,
  getPersonalUser,
  hashPassword,
  isValidPassword,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from '@/app/personal-auth';
import { getD1, getDb } from '@/db';
import { passwordAccounts } from '@/db/schema';
import { validateJsonMutation } from '@/lib/request-security';
import { unicodeLength } from '@/lib/unicode-text';
import { eq } from 'drizzle-orm';

type PasswordChangeBody = {
  currentPassword?: string;
  newPassword?: string;
};

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });

  let body: PasswordChangeBody;
  try {
    body = (await request.json()) as PasswordChangeBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!isValidPassword(newPassword)) return Response.json({ error: 'invalid_new_password' }, { status: 400 });
  if (currentPassword === newPassword) return Response.json({ error: 'password_reused' }, { status: 400 });
  if (unicodeLength(currentPassword) > 128) return Response.json({ error: 'invalid_current_password' }, { status: 401 });

  const account = await getDb().select({
    passwordHash: passwordAccounts.passwordHash,
    passwordSalt: passwordAccounts.passwordSalt,
    passwordIterations: passwordAccounts.passwordIterations,
    sessionVersion: passwordAccounts.sessionVersion,
  }).from(passwordAccounts).where(eq(passwordAccounts.userId, user.userId)).limit(1);
  const existing = account[0];
  if (!existing || !await verifyPassword(currentPassword, existing.passwordHash, existing.passwordSalt, existing.passwordIterations)) {
    return Response.json({ error: 'invalid_current_password' }, { status: 401 });
  }

  const passwordSalt = createPasswordSalt();
  const passwordHash = await hashPassword(newPassword, passwordSalt);
  const updatedAt = Date.now();
  const updated = await getD1().prepare(
    `UPDATE password_accounts
     SET password_hash = ?, password_salt = ?, password_iterations = ?, session_version = session_version + 1, updated_at = ?
     WHERE user_id = ? AND password_hash = ? AND session_version = ?
     RETURNING session_version`,
  ).bind(passwordHash, passwordSalt, PASSWORD_ITERATIONS, updatedAt, user.userId, existing.passwordHash, existing.sessionVersion)
    .first<{ session_version: number }>();
  if (!updated) return Response.json({ error: 'password_changed_elsewhere' }, { status: 409 });

  return Response.json({ ok: true }, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': await createSessionCookie(user.userId, updated.session_version),
    },
  });
}
