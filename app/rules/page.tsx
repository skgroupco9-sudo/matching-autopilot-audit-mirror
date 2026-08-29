import type { Metadata } from 'next';
import { ControlSettingsClient } from '@/app/control-settings-client';

export const metadata: Metadata = { title: 'AI会話ルール', description: 'AIの口調・会話範囲・禁止事項・本人確認条件を設定します。' };

export default function RulesPage() {
  return <ControlSettingsClient mode="rules" />;
}
