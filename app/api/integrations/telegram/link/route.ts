import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { telegramLinkTokens, users } from '@/db/schema';
import { env } from 'cloudflare:workers';
import { eq, lt } from 'drizzle-orm';
import { validateSameOriginMutation } from '@/lib/request-security';

export async function POST(request: Request) {
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const authenticatedUser = await getPersonalUser();
  if (!authenticatedUser) {
    return Response.json({ error: 'authentication_required' }, { status: 401 });
  }

  const botUsername = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '').trim();
  if (!botUsername || !/^[a-zA-Z0-9_]{5,32}$/.test(botUsername)) {
    return Response.json({ error: 'telegram_bot_not_configured' }, { status: 503 });
  }

  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  const token = randomToken();
  const tokenHash = await sha256(token);

  await db
    .insert(users)
    .values({
      id: authenticatedUser.userId,
      email: authenticatedUser.email,
      displayName: authenticatedUser.displayName,
      automationState: 'paused',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: authenticatedUser.email, displayName: authenticatedUser.displayName, updatedAt: now },
    });
  await db.delete(telegramLinkTokens).where(lt(telegramLinkTokens.expiresAt, now));
  await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.userId, authenticatedUser.userId));
  await db.insert(telegramLinkTokens).values({ tokenHash, userId: authenticatedUser.userId, expiresAt, createdAt: now });

  return Response.json({
    link: `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString(),
  });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
