import type { Metadata } from 'next';
import { ControlSettingsClient } from '@/app/control-settings-client';

export const metadata: Metadata = { title: 'マッチング条件', description: '年齢・距離・地域・プロフィール条件を設定します。' };

export default function PreferencesPage() {
  return <ControlSettingsClient mode="preferences" />;
}
