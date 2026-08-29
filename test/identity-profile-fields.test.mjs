import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyExtendedIdentityProfile, normalizeExtendedIdentityProfile, parseExtendedIdentityProfile } from '../lib/identity-profile-fields.ts';
import { toWorkerRegistrationProfile } from '../lib/worker-identity-profile.ts';

test('再利用プロフィールの身長と選択肢を許可リストで検証する', () => {
  assert.equal(normalizeExtendedIdentityProfile({ heightCm: '170', bodyType: 'average' }).ok, true);
  assert.deepEqual(normalizeExtendedIdentityProfile({ heightCm: '99' }), { ok: false, error: 'invalid_height' });
  assert.deepEqual(normalizeExtendedIdentityProfile({ bodyType: 'invented' }), { ok: false, error: 'invalid_body_type' });
});

test('テキストと登録要件を正規化し、破損JSONは安全な空プロフィールへ戻す', () => {
  const result = normalizeExtendedIdentityProfile({ legalName: '  テスト　ユーザー  ', nameKana: ' テスト ユーザー ', interests: `  ${'映画 '.repeat(150)}  `, relationshipGoal: 'marriage', tokyoEligibility: 'resident', singleCertificateStatus: 'requesting', incomeProofStatus: 'ready', preferredLoginMethod: 'email', passwordStrategy: 'service_specific', singleStatusConfirmed: true, previouslyRegisteredServices: ' Pairs、with ', accountRecoveryNotes: ' 公式サポートへ確認中 ', singleAccountPolicyConfirmed: true });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.legalName, 'テスト ユーザー');
    assert.equal(result.value.nameKana, 'テスト ユーザー');
    assert.equal(result.value.interests.length, 300);
    assert.equal(result.value.relationshipGoal, 'marriage');
    assert.equal(result.value.tokyoEligibility, 'resident');
    assert.equal(result.value.singleStatusConfirmed, true);
    assert.equal(result.value.previouslyRegisteredServices, 'Pairs、with');
    assert.equal(result.value.accountRecoveryNotes, '公式サポートへ確認中');
    assert.equal(result.value.singleAccountPolicyConfirmed, true);
  }
  assert.deepEqual(normalizeExtendedIdentityProfile({ tokyoEligibility: 'invented' }), { ok: false, error: 'invalid_tokyo_eligibility' });
  assert.deepEqual(parseExtendedIdentityProfile('{broken'), emptyExtendedIdentityProfile);
});

test('本人確認用氏名は外部ワーカーへ渡さない', () => {
  const workerProfile = toWorkerRegistrationProfile({
    ...emptyExtendedIdentityProfile,
    legalName: '外部へ渡さない氏名',
    registrationEmail: 'test@example.com',
    phoneNumber: '+819012345678',
    nickname: 'みーこ',
    birthDate: '1995-07-18',
    gender: '',
    residence: '',
    occupation: '',
    bio: '',
    phoneOwnershipConfirmed: true,
    registrationAssistEnabled: true,
    gmailCodeAssistEnabled: false,
    updatedAt: null,
  });
  assert.equal('legalName' in workerProfile, false);
  assert.equal('nameKana' in workerProfile, false);
  assert.equal('singleStatusConfirmed' in workerProfile, false);
  assert.equal('previouslyRegisteredServices' in workerProfile, false);
  assert.equal('accountRecoveryNotes' in workerProfile, false);
  assert.equal('incomeProofStatus' in workerProfile, false);
  assert.equal(workerProfile.nickname, 'みーこ');
});
