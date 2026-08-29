import { getPersonalUser } from '@/app/personal-auth';
import { getIdentityProfilePayload } from '@/lib/identity-profile';
import { getConnectorDefinition, serviceCatalogDefinitions } from '@/lib/automation/connectors';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import IdentityClient from './identity-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '登録情報ハブ',
  description: 'マッチングサービスの登録に使う共通写真、メール、電話番号、公開プロフィール、サービス別パスワード、本人確認書類を暗号化して一元管理します。',
};

export default async function IdentityPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const user = await getPersonalUser();
  if (!user) redirect('/');
  const initialData = await getIdentityProfilePayload(user.userId, user);
  const passwordServices = serviceCatalogDefinitions
    .filter((service) => service.availabilityStatus !== 'ended')
    .map((service) => ({
      id: service.id,
      label: service.label,
      registrationFillAvailable: getConnectorDefinition(service.id)?.supportStatus === 'assisted',
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ja'));
  const { gmail } = await searchParams;
  return <IdentityClient initialData={initialData} gmailResult={gmail ?? ''} passwordServices={passwordServices} />;
}
