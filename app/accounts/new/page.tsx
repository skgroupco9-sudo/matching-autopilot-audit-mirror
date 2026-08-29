import { getPersonalUser } from '@/app/personal-auth';
import { connectorDefinitions } from '@/lib/automation/connectors';
import { getIdentityProfilePayload } from '@/lib/identity-profile';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import BulkAccountClient from './bulk-account-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '一括登録準備',
  description: '共通プロフィールと許可済みパスワードを使い、Web版マッチングサービスの新規登録画面をまとめて準備します。',
};

export default async function BulkAccountPage({ searchParams }: { searchParams: Promise<{ providers?: string }> }) {
  const user = await getPersonalUser();
  if (!user) redirect('/');
  const query = await searchParams;
  const identity = await getIdentityProfilePayload(user.userId, user);
  const services = connectorDefinitions.filter((service) => service.webStatus === 'available' && service.supportStatus === 'assisted');
  const initialProviders = query.providers?.split(',').map((provider) => provider.trim()).filter(Boolean) ?? [];
  return <BulkAccountClient services={services} identity={identity} initialProviders={initialProviders} />;
}
