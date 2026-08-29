import type { Metadata } from 'next';
import { TelegramImportClient } from './telegram-import-client';

export const metadata: Metadata = {
  title: 'Telegram履歴取込',
  description: '同意済みのTelegram履歴・テキスト・画像を個人情報を伏せて学習候補へ取り込みます。',
};

export default function TelegramImportPage() {
  return <TelegramImportClient />;
}
