import test from 'node:test';
import assert from 'node:assert/strict';
import { extractContactExchange } from '../lib/automation/contact-extraction.mjs';
import { enrichIncomingContactEvent, formatAutomationReport } from '../lib/automation/telegram-report.ts';
import { assessReply } from '../lib/automation/policy.ts';
import { assessMarriageCandidate, extractMarriageProfileFacts, marriageAppPolicyTier } from '../lib/automation/marriage-policy.ts';
import { acquiredLineHash, acquiredNameAgeHash, normalizeAcquiredDisplayName, sameAcquiredNameAge } from '../lib/automation/acquired-contact.ts';
import { hasProhibitedOffPlatformReference, outgoingReplySafetyViolation } from '../lib/automation/outgoing-language-policy.mjs';
import { connectorDefinitions } from '../lib/automation/connectors.ts';

test('LINE ID・招待URL・QRコードを受領情報として抽出する', () => {
  assert.deepEqual(extractContactExchange('LINE IDは Match.Pilot_05 です'), {
    detected: true,
    channel: 'line',
    lineId: '@match.pilot_05',
    lineUrl: null,
    qrMentioned: false,
    evidenceType: 'line_id',
  });
  const invite = extractContactExchange('ここから追加してね https://line.me/ti/p/~sample-id');
  assert.equal(invite.detected, true);
  assert.equal(invite.lineId, '@sample-id');
  assert.equal(invite.lineUrl, 'https://line.me/ti/p/~sample-id');
  assert.equal(extractContactExchange('LINEのQRコード送ったよ').qrMentioned, true);
  assert.equal(extractContactExchange('LINEで話せたら嬉しいです').detected, false);
});

test('LINE受領報告を固定フォーマットへ変換する', () => {
  const body = 'LINE ID: @sample_55';
  const contactExchange = extractContactExchange(body);
  const report = formatAutomationReport({
    id: 'event_1',
    userId: 'user_1',
    connectionId: 'connection_1',
    conversationId: 'conversation_1',
    type: 'goal_reached',
    occurredAt: new Date().toISOString(),
    payload: {
      provider: 'example',
      displayName: 'テスト相手',
      body,
      contactExchange,
      goalReason: '相手からLINE連絡先を受領しました',
      profileUrl: 'https://example.com/profile/1',
      threadUrl: 'https://example.com/messages/1',
      screenshotObjectKey: 'screenshots/example.png',
    },
  });
  assert.match(report, /✅ LINEを受領しました/);
  assert.match(report, /【LINE ID】@sample_55/);
  assert.match(report, /【相手ページ】https:\/\/example\.com\/profile\/1/);
  assert.match(report, /【会話画面】https:\/\/example\.com\/messages\/1/);
  assert.match(report, /【添付】会話スクリーンショット/);
});

test('LINE受領だけでは婚活意思未確認のため達成扱いにしない', () => {
  const enriched = enrichIncomingContactEvent({
    id: 'event_2',
    userId: 'user_1',
    connectionId: 'connection_1',
    type: 'incoming_message',
    occurredAt: new Date().toISOString(),
    payload: { body: '私のLINE IDは @fast_report です' },
  });
  assert.notEqual(enriched.payload.goalReached, true);
  assert.deepEqual(enriched.payload.contactExchange, {
    detected: true,
    channel: 'line',
    lineId: '@fast_report',
    lineUrl: null,
    qrMentioned: false,
    evidenceType: 'line_id',
  });
});

test('外部連絡先は直接語・隠語とも送信せず受信だけを判定する', () => {
  const policy = {
    mode: 'full_auto',
    minimumConfidence: 85,
    allowedTopics: ['婚活', 'LINE'],
    blockedTopics: [],
    requireApprovalForScheduling: true,
    requireApprovalForContactExchange: false,
    contactExchangeDirection: 'receive_only',
  };
  assert.equal(assessReply('婚活をされているなら、よければLINEを教えてもらえますか？', 92, policy).action, 'block');
  assert.equal(assessReply('よければ緑のやつで話しませんか？', 92, policy).action, 'block');
  assert.equal(assessReply('ラ〇ンを教えていただけますか？', 92, policy).action, 'block');
  assert.equal(assessReply('Iineでお話ししませんか？', 92, policy).action, 'block');
  assert.equal(assessReply('私のLINE IDは own_account_55 です', 92, policy).action, 'block');
  assert.equal(assessReply('こちらのLINE QRコードを送りますね', 92, policy).action, 'block');
  assert.equal(hasProhibitedOffPlatformReference('LINEIDを教えてもらえますか？'), true);
  assert.equal(hasProhibitedOffPlatformReference('オンラインで映画を見ました'), false);
  assert.equal(outgoingReplySafetyViolation('休日は何をして過ごしますか？', ['休日は何をして過ごしますか？']), 'duplicate_reply');
  assert.equal(outgoingReplySafetyViolation('休日は何をして過ごすことが多いですか？', ['休日は何をして過ごすことが多いですか。']), 'near_duplicate_reply');
  assert.equal(outgoingReplySafetyViolation('休みは何してる？', []), 'polite_japanese_required');
  assert.equal(outgoingReplySafetyViolation('休日はどのように過ごすことが多いですか？', []), null);
});

test('サービス一覧と登録準備は推奨・条件付き・禁止ルールを共有する', () => {
  assert.equal(marriageAppPolicyTier('pairs'), 'recommended');
  assert.equal(marriageAppPolicyTier('tinder'), 'conditional');
  assert.equal(marriageAppPolicyTier('jmail'), 'prohibited');
  assert.equal(connectorDefinitions.find((service) => service.id === 'jmail')?.supportStatus, 'catalog_only');
  assert.equal(connectorDefinitions.find((service) => service.id === 'happymail')?.externalAutomationStatus, 'prohibited');
  assert.equal(connectorDefinitions.find((service) => service.id === 'pcmax')?.supportStatus, 'assisted');
});

test('婚活候補は年齢・年収・職業・アプリ条件をすべて満たす', () => {
  const facts = extractMarriageProfileFacts('年収 600万円〜800万円 いいね 24 NEW 有料会員');
  assert.deepEqual(facts, { annualIncomeMinimum: 600, likesCount: 24, hasNewBadge: true, isPaidMember: true });
  assert.equal(assessMarriageCandidate({ provider: 'pairs', age: 42, ...facts, hasFacePhoto: true }).eligible, true);
  assert.equal(assessMarriageCandidate({ provider: 'pairs', age: 42, annualIncomeMinimum: 399, hasNewBadge: true }).eligible, false);
  assert.equal(assessMarriageCandidate({ provider: 'tinder', age: 39, annualIncomeMinimum: 800 }).eligible, false);
  assert.equal(assessMarriageCandidate({ provider: 'jmail', age: 45, annualIncomeMinimum: 800 }).eligible, false);
  assert.equal(assessMarriageCandidate({ provider: 'match', age: 45, annualIncomeMinimum: 800, hasFacePhoto: false }).eligible, false);
  assert.equal(assessMarriageCandidate({ provider: 'pairs', age: 45, annualIncomeMinimum: 1300, occupation: '会社経営' , hasNewBadge: true }).eligible, false);
  assert.equal(assessMarriageCandidate({ provider: 'pairs', age: 45, annualIncomeMinimum: 1300, occupation: '医師', hasNewBadge: true }).eligible, true);
});

test('いいね数がない・非表示・測定不能なアプリは候補から除外しない', () => {
  assert.equal(assessMarriageCandidate({ provider: 'with', age: 45, annualIncomeMinimum: 600 }).eligible, true);
  assert.equal(assessMarriageCandidate({ provider: 'with', age: 45, annualIncomeMinimum: 600, likesCount: 0 }).eligible, true);
  assert.equal(assessMarriageCandidate({ provider: 'with', age: 45, annualIncomeMinimum: 600, likesCount: 30 }).eligible, true);
  assert.equal(assessMarriageCandidate({ provider: 'with', age: 45, annualIncomeMinimum: 600, likesCount: 31 }).eligible, false);
});

test('過去獲得者は表記ゆれを吸収してアプリ横断で照合する', async () => {
  assert.equal(normalizeAcquiredDisplayName(' 山田・太郎 '), '山田太郎');
  assert.equal(sameAcquiredNameAge(
    { displayName: '山田・太郎', age: 42 },
    { displayName: ' 山田 太郎 ', age: 42 },
  ), true);
  assert.equal(sameAcquiredNameAge(
    { displayName: '山田太郎', age: 42 },
    { displayName: '山田太郎', age: 43 },
  ), false);
  assert.equal(
    await acquiredNameAgeHash({ displayName: '山田・太郎', age: 42 }),
    await acquiredNameAgeHash({ displayName: '山田 太郎', age: 42 }),
  );
  assert.equal(
    await acquiredLineHash({ lineId: '@Sample.LINE_1' }),
    await acquiredLineHash({ lineId: '@sample.line_1' }),
  );
  assert.equal(await acquiredNameAgeHash({ displayName: '山田太郎' }), undefined);
});
