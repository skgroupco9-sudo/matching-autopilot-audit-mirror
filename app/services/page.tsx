import type { Metadata } from 'next';
import { serviceCatalogDefinitions } from '@/lib/automation/connectors';
import { ServicesClient } from './services-client';

export const metadata: Metadata = {
  title: '対応アプリ一覧',
  description: 'マッチングサービスを検索し、公式ログイン・新規登録・接続準備を一か所から開始できます。',
};

export default function ServicesPage() {
  return <ServicesClient services={serviceCatalogDefinitions} />;
}
