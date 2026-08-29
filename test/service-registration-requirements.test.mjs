import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyExtendedIdentityProfile } from '../lib/identity-profile-fields.ts';
import { getServiceRegistrationReadiness, serviceRegistrationRequirements } from '../lib/service-registration-requirements.ts';

const base = {
  ...emptyExtendedIdentityProfile,
  registrationEmail: 'test@example.com',
  phoneNumber: '+819012345678',
  nickname: 'みーこ',
  birthDate: '1995-07-18',
  gender: 'female',
  residence: '東京都',
  occupation: '',
  bio: '',
  phoneOwnershipConfirmed: true,
  registrationAssistEnabled: true,
  gmailCodeAssistEnabled: false,
  updatedAt: null,
  hasFacePhoto: false,
  hasIdentityDocument: true,
  credentialServiceKeys: new Set(),
};

test('17サービスを登録要件として管理する', () => {
  assert.equal(serviceRegistrationRequirements.length, 17);
  assert.equal(new Set(serviceRegistrationRequirements.map((service) => service.id)).size, 17);
});

test('TOKYO縁結びは証明書と都内条件を不足として検出する', () => {
  const service = serviceRegistrationRequirements.find((candidate) => candidate.id === 'tokyo-enmusubi');
  assert.ok(service);
  const readiness = getServiceRegistrationReadiness(service, base);
  assert.equal(readiness.complete, false);
  assert.equal(readiness.missing.includes('single_certificate'), true);
  assert.equal(readiness.missing.includes('income_proof'), true);
  assert.equal(readiness.missing.includes('tokyo_eligibility'), true);
  assert.equal(readiness.missing.includes('face_photo'), true);
});

test('回答・顔写真・個別パスワードがそろうと要件へ反映する', () => {
  const service = serviceRegistrationRequirements.find((candidate) => candidate.id === 'ange');
  assert.ok(service);
  const readiness = getServiceRegistrationReadiness(service, {
    ...base,
    relationshipGoal: 'marriage',
    singleStatusConfirmed: true,
    hasFacePhoto: true,
    credentialServiceKeys: new Set(['ange']),
  });
  assert.equal(readiness.complete, true);
});
