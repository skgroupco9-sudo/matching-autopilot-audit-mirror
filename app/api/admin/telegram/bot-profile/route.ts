import { getPersonalUser } from '@/app/personal-auth';
import { TELEGRAM_BOT_DISPLAY_NAME } from '@/lib/telegram-bot-profile';
import { getTelegramBotProfile, setTelegramBotDisplayName } from '@/lib/telegram';
import { validateJsonMutation } from '@/lib/request-security';

export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = await getPersonalUser();
  if (!admin) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (admin.role !== 'admin') return Response.json({ error: 'admin_required' }, { status: 403 });
  try {
    return Response.json({ profile: await getTelegramBotProfile(), desiredName: TELEGRAM_BOT_DISPLAY_NAME }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'telegram_unavailable' }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const requestError = validateJsonMutation(request);
  if (requestError) return requestError;
  const admin = await getPersonalUser();
  if (!admin) return Response.json({ error: 'authentication_required' }, { status: 401 });
  if (admin.role !== 'admin') return Response.json({ error: 'admin_required' }, { status: 403 });
  try {
    return Response.json({ profile: await setTelegramBotDisplayName(TELEGRAM_BOT_DISPLAY_NAME) }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'telegram_update_failed' }, { status: 502 });
  }
}
