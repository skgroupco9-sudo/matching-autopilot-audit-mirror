import assert from 'node:assert/strict';
import test from 'node:test';
import { allowsExternalAutomation, assertExternalAutomationAllowed, assertProviderUrl, confirmBlockAction, detectCheckpoint, fillRegistrationCredentials, openBlockAction } from '../src/adapters.mjs';

const webEntries = [
  ['pairs', 'https://pairs.lv/'],
  ['with', 'https://with.is/welcome'],
  ['omiai', 'https://www.omiai-jp.com/login'],
  ['marrish', 'https://marrish.com/auth/loginselection'],
  ['youbride', 'https://youbride.jp/auth/login'],
  ['bridalnet', 'https://www.bridalnet.co.jp/login/'],
  ['match', 'https://jp.match.com/login'],
  ['r50time', 'https://app.r50time.jp/login'],
  ['wakuwaku', 'https://550909.com/'],
  ['ikukuru', 'https://www.194964.com/'],
  ['happymail', 'https://happymail.co.jp/login/'],
  ['pcmax', 'https://pcmax.jp/pcm/'],
  ['jmail', 'https://mintj.com/'],
  ['asobo', 'https://aso-bo.com/login.php'],
  ['merupara', 'https://meru-para.com/msm/login/'],
  ['hanakai', 'https://hana-mail.jp/'],
  ['sugardaddy', 'https://sugardaddy.jp/login'],
  ['paters', 'https://paters.jp/users/sign_in'],
  ['paddy', 'https://www.paddy67.today/'],
  ['pj', 'https://pj88.jp/users/sign_in'],
  ['mypappy', 'https://mypappy.jp/signup'],
  ['mitsumitsu', 'https://lp.mitsumitsu-app.com/'],
  ['cuddle', 'https://www.cuddle-jp.com/signin'],
  ['kikonclub', 'https://kikonclub.com/login'],
  ['anemone', 'https://app.anemone.blue/'],
  ['silk', 'https://app.silk-jp.com/'],
  ['healmate', 'https://healmate.jp/login'],
  ['marriedgo', 'https://marriedgo.com/'],
  ['partners', 'https://www.partner-s.net/signin/entry.php'],
  ['bachelor-date', 'https://new.bachelorapp.net/'],
  ['ciel', 'https://cielmatch.com/howto'],
];

test('31件の公開Web入口をHTTPS許可リストで受け付ける', () => {
  assert.equal(webEntries.length, 31);
  assert.equal(new Set(webEntries.map(([provider]) => provider)).size, 31);
  for (const [provider, url] of webEntries) assert.equal(assertProviderUrl(provider, url), url);
});

test('別サービス・偽装サブドメイン・HTTPを拒否する', () => {
  assert.throws(() => assertProviderUrl('pairs', 'https://tinder.com/app/login'), /unsafe_navigation_host/);
  assert.throws(() => assertProviderUrl('pairs', 'https://pairs.lv.example.com/'), /unsafe_navigation_host/);
  assert.throws(() => assertProviderUrl('pairs', 'http://pairs.lv/'), /unsafe_navigation_protocol/);
  assert.throws(() => assertProviderUrl('unknown', 'https://example.com/'), /unsupported_provider/);
  assert.throws(() => assertProviderUrl('tinder', 'https://tinder.com/app/login'), /unsupported_provider/);
});

test('正規サービスのサブドメインだけを許可する', () => {
  assert.equal(assertProviderUrl('healmate', 'https://my.healmate.jp/register'), 'https://my.healmate.jp/register');
  assert.equal(assertProviderUrl('omiai', 'https://fb.omiai-jp.com/register.html'), 'https://fb.omiai-jp.com/register.html');
});

test('禁止または許可未確認のサービスは外部巡回・送信へ進めない', () => {
  assert.equal(allowsExternalAutomation('with'), false);
  assert.equal(allowsExternalAutomation('omiai'), false);
  assert.equal(allowsExternalAutomation('marrish'), false);
  assert.equal(allowsExternalAutomation('pairs'), false);
  assert.equal(allowsExternalAutomation('youbride'), false);
  assert.throws(() => assertExternalAutomationAllowed('with'), /external_automation_not_permitted:with/);
  assert.throws(() => assertExternalAutomationAllowed('youbride'), /external_automation_not_permitted:youbride/);
});

test('登録パスワード補助は入力だけ行い送信やクリックを実行しない', () => {
  const implementation = fillRegistrationCredentials.toString();
  assert.match(implementation, /element\.type === 'password'/);
  assert.doesNotMatch(implementation, /\.click\s*\(|requestSubmit\s*\(|\.submit\s*\(/);
});

test('利用停止・凍結表示は自動操作の停止条件として検知する', () => {
  const implementation = detectCheckpoint.toString();
  assert.match(implementation, /account_restricted/);
  assert.match(implementation, /アカウント/);
  assert.match(implementation, /suspended/);
});

test('ブロック操作は曖昧な候補をクリックせず確認ダイアログも一意に限定する', () => {
  const opener = openBlockAction.toString();
  const confirmer = confirmBlockAction.toString();
  assert.match(opener, /blockActions\.length === 1/);
  assert.match(opener, /menus\.length !== 1/);
  assert.match(confirmer, /dialogs\.length !== 1/);
  assert.match(confirmer, /confirmations\.length !== 1/);
});
