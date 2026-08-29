import type { Metadata } from 'next';
import { getPersonalUser } from '@/app/personal-auth';
import { redirect } from 'next/navigation';
import WorkerSetupClient from './worker-setup-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ワーカー認証',
  description: 'ローカルブラウザワーカーをユーザーアカウントへ安全に固定します。',
};

export default async function WorkerSetupPage() {
  const user = await getPersonalUser();
  if (!user) redirect('/');
  return <WorkerSetupClient userId={user.userId} />;
}
