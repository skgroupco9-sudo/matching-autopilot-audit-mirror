import type { Metadata } from 'next';
import { japaneseServiceProfiles } from '@/lib/japan-service-comparison';
import { CompareClient } from './compare-client';

export const metadata: Metadata = {
  title: '日本のサービス比較',
  description: '目的・年代・重視点から、日本の主要マッチングサービスを公式情報に基づいて比較します。',
};

export default function ComparePage() {
  return <CompareClient services={japaneseServiceProfiles} />;
}
