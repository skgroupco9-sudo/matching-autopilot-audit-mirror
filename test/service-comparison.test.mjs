import assert from 'node:assert/strict';
import test from 'node:test';
import { rankJapaneseServices } from '../lib/japan-service-comparison.ts';

test('手間の少なさでは公式AIいいねを持つRavitを優先する', () => {
  const result = rankJapaneseServices({ goal: 'relationship', ageBand: '30s', priority: 'least_work', browserOnly: true });
  assert.equal(result[0].service.id, 'ravit');
  assert.ok(result[0].reasons.includes('公式AIが候補へのいいねを支援'));
});

test('40代の再婚希望ではmarrishを最上位にする', () => {
  const result = rankJapaneseServices({ goal: 'remarriage', ageBand: '40s', priority: 'serious', browserOnly: true });
  assert.equal(result[0].service.id, 'marrish');
});

test('ブラウザ優先時はアプリ専用のGoensを上位3件から外す', () => {
  const result = rankJapaneseServices({ goal: 'companionship', ageBand: '50plus', priority: 'values', browserOnly: true });
  assert.ok(!result.slice(0, 3).some(({ service }) => service.id === 'goens'));
});
