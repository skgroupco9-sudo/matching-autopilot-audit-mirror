export const TELEGRAM_BOT_DISPLAY_NAME = 'L婚サポート２';

export function normalizeTelegramBotDisplayName(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  return normalized && [...normalized].length <= 64 ? normalized : null;
}
