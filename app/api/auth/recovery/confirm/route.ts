import { createPasswordSalt, createSessionCookie, hashPassword, isValidPassword, PASSWORD_ITERATIONS } from '@/app/personal-auth';
import { consumeTelegramAuthChallenge } from '@/lib/auth-challenges';
import { getD1 } from '@/db';
import { validateJsonMutation } from '@/lib/request-security';

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  let body: { challengeId?: string; code?: string; newPassword?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const password = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!isValidPassword(password)) return Response.json({ error: 'invalid_new_password' }, { status: 400 });
  const userId = await consumeTelegramAuthChallenge(body.challengeId ?? '', 'password_reset', body.code ?? '');
  if (!userId) return Response.json({ error: 'invalid_or_expired_code' }, { status: 401 });
  const salt = createPasswordSalt();
  const hash = await hashPassword(password, salt);
  const now = Date.now();
  const updated = await getD1().prepare(
    `UPDATE password_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, session_version = session_version + 1, last_login_at = ?, updated_at = ? WHERE user_id = ? RETURNING session_version`,
  ).bind(hash, salt, PASSWORD_ITERATIONS, now, now, userId).first<{ session_version: number }>();
  if (!updated) return Response.json({ error: 'account_unavailable' }, { status: 409 });
  return Response.json({ ok: true }, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': await createSessionCookie(userId, updated.session_version),
    },
  });
}
