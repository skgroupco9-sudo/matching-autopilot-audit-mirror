import { env } from 'cloudflare:workers';
import { normalizeTelegramBotDisplayName } from '@/lib/telegram-bot-profile';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';

type TelegramButton = { text: string; callbackData: string };

export async function sendTelegramReport(input: {
  chatId: string;
  text: string;
  buttons?: TelegramButton[];
  image?: { bytes: ArrayBuffer; contentType: string; filename: string };
}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');

  const replyMarkup = input.buttons?.length
    ? JSON.stringify({
        inline_keyboard: [
          input.buttons.map((button) => ({
            text: button.text,
            callback_data: button.callbackData,
          })),
        ],
      })
    : undefined;

  let response: Response;
  if (input.image) {
    const form = new FormData();
    form.set('chat_id', input.chatId);
    form.set('caption', input.text.slice(0, 1024));
    form.set('photo', new Blob([input.image.bytes], { type: input.image.contentType }), input.image.filename);
    if (replyMarkup) form.set('reply_markup', replyMarkup);
    response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
  } else {
    response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text.slice(0, 4096),
        reply_markup: replyMarkup ? JSON.parse(replyMarkup) : undefined,
      }),
    });
  }

  if (!response.ok) {
    throw new Error(`Telegram API returned ${response.status}.`);
  }

  return (await response.json()) as {
    ok: boolean;
    result?: { message_id?: number };
  };
}

export async function answerTelegramCallback(callbackQueryId: string, text: string) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  await fetchWithTimeout(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export async function getTelegramBotProfile() {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Telegram API returned ${response.status}.`);
  const result = await response.json() as { ok: boolean; result?: { first_name?: string; username?: string } };
  if (!result.ok || !result.result?.username) throw new Error('Telegram Bot profile is unavailable.');
  return { name: result.result.first_name ?? '', username: result.result.username };
}

export async function setTelegramBotDisplayName(value: unknown) {
  const name = normalizeTelegramBotDisplayName(value);
  if (!name) throw new Error('invalid_telegram_bot_name');
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/setMyName`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Telegram API returned ${response.status}.`);
  const result = await response.json() as { ok: boolean };
  if (!result.ok) throw new Error('Telegram Bot name update failed.');
  return getTelegramBotProfile();
}
