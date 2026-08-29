import type { Metadata } from 'next';
import { getPersonalUser } from '@/app/personal-auth';
import { redirect } from 'next/navigation';
import SecurityClient from './security-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'セキュリティと復旧',
  description: '2段階認証、暗号化バックアップ、総合セルフテストを管理します。',
};

export default async function SecurityPage() {
  const user = await getPersonalUser();
  if (!user) redirect('/');
  return <SecurityClient />;
}
