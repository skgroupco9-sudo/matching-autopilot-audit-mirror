export const AUTH_CHALLENGE_TTL_MS = 10 * 60_000;
export const AUTH_CHALLENGE_RESEND_COOLDOWN_MS = 60_000;
export const AUTH_CHALLENGE_MAX_ATTEMPTS = 5;

export function isAuthCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}
