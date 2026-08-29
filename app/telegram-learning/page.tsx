import type { Metadata } from 'next';
import { TelegramLearningClient } from './telegram-learning-client';

export const metadata: Metadata = {
  title: 'Telegram報告・会話学習',
  description: '他のTelegramグループから転送した報告例・会話例・NGを確認し、MatchPilotへ反映します。',
};

export default function TelegramLearningPage() {
  return <TelegramLearningClient />;
}
