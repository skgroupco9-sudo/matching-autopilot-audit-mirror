const providers = {
  pairs: standard(['pairs.lv']),
  with: standard(['with.is'], undefined, 'prohibited'),
  omiai: standard(['omiai-jp.com'], undefined, 'prohibited'),
  marrish: standard(['marrish.com'], undefined, 'prohibited'),
  youbride: standard(['youbride.jp']),
  bridalnet: standard(['bridalnet.co.jp']),
  match: standard(['match.com']),
  r50time: standard(['r50time.jp']),
  wakuwaku: beta(['550909.com']),
  ikukuru: beta(['194964.com']),
  happymail: beta(['happymail.co.jp']),
  pcmax: beta(['pcmax.jp']),
  jmail: beta(['mintj.com']),
  asobo: beta(['aso-bo.com']),
  merupara: beta(['meru-para.com']),
  hanakai: beta(['hana-mail.jp']),
  sugardaddy: beta(['sugardaddy.jp']),
  paters: beta(['paters.jp']),
  paddy: beta(['paddy67.today']),
  pj: beta(['pj88.jp']),
  mypappy: beta(['mypappy.jp']),
  mitsumitsu: beta(['mitsumitsu-app.com']),
  cuddle: beta(['cuddle-jp.com']),
  kikonclub: beta(['kikonclub.com']),
  anemone: beta(['anemone.blue']),
  silk: beta(['silk-jp.com']),
  healmate: beta(['healmate.jp']),
  marriedgo: beta(['marriedgo.com']),
  partners: beta(['partner-s.net']),
  'bachelor-date': beta(['bachelorapp.net']),
  ciel: beta(['cielmatch.com']),
};

function standard(hosts, profilePaths = ['/profile', '/user', '/member', '/search'], externalAutomation = 'unverified') {
  return { hosts, profilePaths, tier: 'standard', externalAutomation };
}

function beta(hosts, profilePaths = ['/profile', '/user', '/member', '/search', '/detail']) {
  return { hosts, profilePaths, tier: 'beta', externalAutomation: 'unverified' };
}

export function allowsExternalAutomation(provider) {
  return providers[provider]?.externalAutomation === 'allowed';
}

export function assertExternalAutomationAllowed(provider) {
  if (!allowsExternalAutomation(provider)) throw new Error(`external_automation_not_permitted:${provider}`);
}

export function assertProviderUrl(provider, rawUrl) {
  const definition = providers[provider];
  if (!definition) throw new Error(`unsupported_provider:${provider}`);
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('unsafe_navigation_protocol');
  if (!definition.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`unsafe_navigation_host:${url.hostname}`);
  }
  return url.toString();
}

export async function detectCheckpoint(browser) {
  return browser.evaluate(() => {
    const text = document.body?.innerText?.slice(0, 20_000).toLowerCase() ?? '';
    const url = location.href.toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 36 && rect.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const inputs = [...document.querySelectorAll('input')].filter(visible);
    const actions = [...document.querySelectorAll('button, a[href], [role="button"]')].filter(visible);
    if (/(?:アカウント(?:が|は)?(?:停止|凍結)|利用(?:を|が)?停止(?:しました|されています)|このアカウントは利用できません|account (?:suspended|disabled|banned))/.test(text)) return 'account_restricted';
    if (/captcha|ロボットではない|recaptcha/i.test(text) || document.querySelector('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]')) return 'captcha';
    const otpInput = inputs.some((element) => {
      const hint = `${element.autocomplete} ${element.inputMode} ${element.name} ${element.id} ${element.placeholder} ${element.getAttribute('aria-label') || ''}`.toLowerCase();
      return /one-time-code|otp|verification|認証コード|確認コード|ワンタイム/.test(hint);
    });
    if (/\/(?:verify|verification|otp)(?:\/|\?|$)/.test(url) || otpInput) return 'email_or_sms_otp';
    const identityUpload = inputs.some((element) => element.type === 'file' && /本人確認|年齢確認|身分証|免許証|identity|document/.test(`${element.name} ${element.id} ${element.getAttribute('aria-label') || ''} ${element.parentElement?.textContent || ''}`.toLowerCase()));
    if (/\/(?:identity|age[-_]?verif|kyc)(?:\/|\?|$)/.test(url) || identityUpload) return 'identity_verification';
    const consentControl = inputs.some((element) => element.type === 'checkbox' && /利用規約|規約に同意|terms/.test((element.closest('label')?.textContent || element.parentElement?.textContent || '').toLowerCase()));
    if (consentControl) return 'terms_consent';
    const paymentAction = actions.some((element) => /^(購入を確定|支払いを確定|決済を確定|confirm payment|pay now)$/.test((element.getAttribute('aria-label') || element.textContent || '').trim().toLowerCase()));
    if (paymentAction) return 'payment_confirmation';
    if (/\/(?:login|signin|auth)(?:\/|\?|$)/.test(url)) return 'initial_login';
    const authInput = inputs.some((element) => {
      const hint = `${element.type} ${element.autocomplete} ${element.name} ${element.placeholder} ${element.getAttribute('aria-label') || ''}`.toLowerCase();
      return /password|email|tel|phone|username|メール|電話番号/.test(hint);
    });
    const authAction = actions.some((element) => {
      const label = (element.getAttribute('aria-label') || element.textContent || '').trim().toLowerCase();
      return /^(ログイン|新規登録|無料ではじめる|はじめる|sign in|sign up|register|start)$/.test(label);
    });
    const signedInMarker = /ログアウト|マイページ|受信メッセージ|プロフィール編集|設定/.test(text);
    if ((authInput || authAction) && !signedInMarker) return 'initial_login';
    return null;
  });
}

export async function fillRegistrationProfile(browser, profile) {
  return browser.evaluate((values) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 80 && rect.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none' && !element.disabled && !element.readOnly;
    };
    const controls = [...document.querySelectorAll('input, select, textarea')].filter((element) => {
      if (!visible(element)) return false;
      if (element instanceof HTMLInputElement && ['password', 'hidden', 'file', 'checkbox', 'radio', 'submit', 'button'].includes(element.type)) return false;
      return true;
    });
    const description = (element) => {
      const label = element.labels ? [...element.labels].map((item) => item.textContent || '').join(' ') : '';
      return `${element.getAttribute('autocomplete') || ''} ${element.getAttribute('name') || ''} ${element.id || ''} ${element.getAttribute('placeholder') || ''} ${element.getAttribute('aria-label') || ''} ${label}`.normalize('NFKC').toLowerCase();
    };
    const patterns = [
      ['registrationEmail', /(?:^|\s)(?:email|e-mail|mail|メール)(?:\s|$)|メールアドレス/],
      ['phoneNumber', /(?:^|\s)(?:tel|phone|mobile)(?:\s|$)|電話番号|携帯番号/],
      ['nickname', /nickname|display.?name|screen.?name|ニックネーム|表示名/],
      ['birthDate', /(?:^|\s)bday(?:\s|$)|birth|生年月日/],
      ['residence', /address-level1|prefecture|residence|location|都道府県|居住地/],
      ['occupation', /organization-title|occupation|job|職業/],
      ['bio', /(?:^|\s)bio(?:\s|$)|about.?me|profile.?text|自己紹介/],
      ['heightCm', /height|身長/],
      ['hometown', /hometown|birthplace|出身地/],
      ['workSchedule', /work.?schedule|holiday|休日|勤務形態/],
      ['languages', /languages?|言語|話せる言葉/],
      ['interests', /interests?|hobb(?:y|ies)|趣味|興味/],
      ['personality', /personality|character|性格/],
      ['firstDatePreference', /first.?date|初回デート|初デート|会いたい場所/],
    ];
    const filledFields = [];
    for (const [field, pattern] of patterns) {
      const value = typeof values[field] === 'string' ? values[field].trim() : '';
      if (!value) continue;
      const target = controls.find((control) => pattern.test(description(control)));
      if (!target) continue;
      const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(target, value);
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      filledFields.push(field);
    }
    if (values.gender) {
      const select = controls.find((control) => control instanceof HTMLSelectElement && /gender|sex|性別/.test(description(control)));
      if (select instanceof HTMLSelectElement) {
        const labels = { male: /male|男性|男$/, female: /female|女性|女$/, non_binary: /non.?binary|ノンバイナリー/, other: /other|その他/ };
        const matcher = labels[values.gender];
        const option = matcher ? [...select.options].find((item) => matcher.test(`${item.value} ${item.text}`.toLowerCase())) : null;
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          filledFields.push('gender');
        }
      }
    }
    const selectionFields = [
      ['bodyType', /body.?type|build|体型/, {
        slim: /slim|thin|スリム|細め/, average: /average|normal|普通/, athletic: /athletic|muscular|筋肉|スポーツ/, curvy: /curvy|グラマー/, large: /large|big|大柄/,
      }],
      ['education', /education|学歴/, {
        high_school: /high.?school|高校/, vocational: /vocational|専門/, junior_college: /junior.?college|短大|高専/, university: /university|college|大学/, graduate_school: /graduate|大学院/, other: /other|その他/,
      }],
      ['annualIncome', /income|salary|年収/, {
        under_2m: /200.*未満|under.*2/, '2m_4m': /200.*400|2.*4/, '4m_6m': /400.*600|4.*6/, '6m_8m': /600.*800|6.*8/, '8m_10m': /800.*1[,，]?000|8.*10/, '10m_15m': /1[,，]?000.*1[,，]?500|10.*15/, over_15m: /1[,，]?500.*以上|over.*15/,
      }],
      ['maritalHistory', /marital|marriage.?history|婚姻歴|結婚歴/, {
        never_married: /never|未婚/, divorced: /divorc|離婚/, widowed: /widow|死別/,
      }],
      ['children', /children|kids|子ども|子供/, {
        none: /none|no children|いない|なし/, has_children_living_together: /together|同居/, has_children_living_apart: /apart|別居/,
      }],
      ['smoking', /smok|タバコ|喫煙/, {
        never: /never|吸わない|非喫煙/, occasionally: /occasion|ときどき|たまに/, regularly: /regular|吸う/, trying_to_quit: /quit|禁煙中/,
      }],
      ['alcohol', /alcohol|drink|お酒|飲酒/, {
        never: /never|飲まない/, occasionally: /occasion|ときどき|たまに/, socially: /social|付き合い/, regularly: /regular|よく飲む/,
      }],
      ['relationshipGoal', /relationship.?goal|looking.?for|purpose|目的|出会い/, {
        serious_relationship: /serious|真剣.*交際/, marriage: /marriage|結婚/, friendship_first: /friend|友達/, casual_dating: /casual|気軽.*デート/, activity_partner: /activity|趣味仲間/,
      }],
    ];
    for (const [field, fieldPattern, optionPatterns] of selectionFields) {
      const value = values[field];
      if (!value || value === 'prefer_not_to_say') continue;
      const select = controls.find((control) => control instanceof HTMLSelectElement && fieldPattern.test(description(control)));
      const optionPattern = optionPatterns[value];
      if (!(select instanceof HTMLSelectElement) || !optionPattern) continue;
      const option = [...select.options].find((item) => optionPattern.test(`${item.value} ${item.text}`.normalize('NFKC').toLowerCase()));
      if (!option) continue;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      filledFields.push(field);
    }
    return { filledFields: [...new Set(filledFields)] };
  }, profile);
}

export async function fillRegistrationPhoto(browser, filePath) {
  const marker = `matchpilot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const found = await browser.evaluate((value) => {
    const candidates = [...document.querySelectorAll('input[type="file"]')].filter((input) => {
      const label = input.labels ? [...input.labels].map((item) => item.textContent || '').join(' ') : '';
      const hint = `${input.name} ${input.id} ${input.accept} ${input.getAttribute('aria-label') || ''} ${label} ${input.parentElement?.textContent || ''}`.normalize('NFKC').toLowerCase();
      return /profile|avatar|icon|photo|image|プロフィール|アイコン|顔写真|写真/.test(hint)
        && !/本人確認|身分証|免許証|passport|identity|document|kyc/.test(hint);
    });
    if (candidates.length !== 1) return { ok: false, reason: `profile_photo_input_count:${candidates.length}` };
    candidates[0].setAttribute('data-matchpilot-photo-input', value);
    return { ok: true };
  }, marker);
  if (!found.ok) return { filled: false, reason: found.reason };
  const selector = `[data-matchpilot-photo-input="${marker}"]`;
  try {
    await browser.setFileInputFile(selector, filePath);
    await browser.evaluate((value) => {
      const input = document.querySelector(`[data-matchpilot-photo-input="${value}"]`);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    }, marker);
    return { filled: true };
  } finally {
    await browser.evaluate((value) => document.querySelector(`[data-matchpilot-photo-input="${value}"]`)?.removeAttribute('data-matchpilot-photo-input'), marker).catch(() => undefined);
  }
}

export async function fillRegistrationCredentials(browser, credential) {
  return browser.evaluate((values) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 80 && rect.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none' && !element.disabled && !element.readOnly;
    };
    const describe = (element) => {
      const label = element.labels ? [...element.labels].map((item) => item.textContent || '').join(' ') : '';
      return `${element.autocomplete} ${element.name} ${element.id} ${element.placeholder} ${element.getAttribute('aria-label') || ''} ${label}`.normalize('NFKC').toLowerCase();
    };
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const filledFields = [];
    const inputs = [...document.querySelectorAll('input')].filter((element) => visible(element));
    const loginId = typeof values.loginId === 'string' ? values.loginId : '';
    if (loginId) {
      const loginInput = inputs.find((element) => element.type !== 'password' && !element.value && /username|login.?id|member.?id|account|email|e-mail|mail|メール|会員id|ログインid/.test(describe(element)));
      if (loginInput) {
        setValue(loginInput, loginId);
        filledFields.push('serviceLoginId');
      }
    }
    const password = typeof values.password === 'string' ? values.password : '';
    const passwordInputs = inputs.filter((element) => element.type === 'password');
    if (password && passwordInputs.length >= 1 && passwordInputs.length <= 2) {
      for (const input of passwordInputs) setValue(input, password);
      filledFields.push('servicePassword');
    }
    return { filledFields };
  }, credential);
}

export async function fillVerificationCode(browser, code) {
  return browser.evaluate((value) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 36 && rect.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none' && !element.disabled && !element.readOnly;
    };
    const inputs = [...document.querySelectorAll('input')].filter((element) => {
      if (!visible(element) || ['password', 'hidden', 'file'].includes(element.type)) return false;
      const label = element.labels ? [...element.labels].map((item) => item.textContent || '').join(' ') : '';
      const hint = `${element.autocomplete} ${element.name} ${element.id} ${element.placeholder} ${element.getAttribute('aria-label') || ''} ${label}`.normalize('NFKC').toLowerCase();
      return /one-time-code|otp|verification|認証|確認コード|ワンタイム/.test(hint);
    });
    if (inputs.length !== 1) return { filled: false, reason: `verification_input_count:${inputs.length}` };
    const input = inputs[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
    return { filled: true };
  }, code);
}

export async function discoverCandidates(browser, provider) {
  const definition = providers[provider];
  return browser.evaluate((paths, tier) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 24 && rect.height > 24 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const rows = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (!visible(anchor)) continue;
      const url = new URL(anchor.href, location.href);
      if (!paths.some((path) => url.pathname.toLowerCase().includes(path))) continue;
      const text = (anchor.getAttribute('aria-label') || anchor.querySelector('img')?.alt || anchor.innerText || '').trim().split('\n')[0]?.slice(0, 40);
      if (!text || text.length < 1 || seen.has(url.href)) continue;
      const fullText = (anchor.innerText || '').slice(0, 500);
      const age = Number(fullText.match(/(?:^|\s)(1[89]|[2-9]\d)\s*歳?/)?.[1]) || null;
      const distanceKm = Number(fullText.match(/(\d{1,3})\s*km/i)?.[1]) || null;
      const locationText = fullText.match(/(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/)?.[1] || null;
      const annualIncomeMinimum = Number(fullText.match(/年収[^0-9]{0,12}([0-9]{3,4})/)?.[1]) || null;
      const likesCount = Number(fullText.match(/いいね(?:数)?[^0-9]{0,8}([0-9]{1,4})/)?.[1]) || null;
      const hasNewBadge = /(?:NEW|今週入会|新規入会)/i.test(fullText);
      const hasFacePhoto = Boolean(anchor.querySelector('img[src]'));
      const isPaidMember = /(?:有料会員|課金済み|プレミアム会員)/.test(fullText);
      seen.add(url.href);
      rows.push({ externalReference: url.pathname, displayName: text, age, distanceKm, location: locationText, profileSnippet: fullText, profileUrl: url.href, annualIncomeMinimum, likesCount, hasNewBadge, hasFacePhoto, isPaidMember, sourceReliability: tier === 'standard' ? 'verified' : 'heuristic' });
      if (rows.length >= 20) break;
    }
    return rows;
  }, definition.profilePaths, definition.tier);
}

export async function discoverConversationLinks(browser, provider) {
  return browser.evaluate(() => {
    const links = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      const url = new URL(anchor.href, location.href);
      const hint = `${url.pathname} ${anchor.getAttribute('aria-label') ?? ''} ${anchor.textContent ?? ''}`.toLowerCase();
      if (!/(message|messages|chat|conversation|talk|match|メッセージ|トーク)/.test(hint)) continue;
      if (/(setting|help|support|privacy)/.test(hint) || seen.has(url.href)) continue;
      seen.add(url.href);
      links.push(url.href);
      if (links.length >= 8) break;
    }
    return links;
  }, provider);
}

export async function readConversationSnapshot(browser, provider) {
  const reliability = providers[provider]?.tier === 'standard' ? 'verified' : 'heuristic';
  return browser.evaluate((sourceReliability) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const editorCount = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')].filter(visible).length;
    if (editorCount !== 1) return null;
    const messageElements = [...document.querySelectorAll('[data-testid*="message" i], [class*="message" i], [class*="bubble" i], [role="listitem"]')]
      .filter(visible)
      .map((element) => ({
        text: (element.innerText || element.textContent || '').trim(),
        hint: `${element.className || ''} ${element.getAttribute('data-testid') || ''}`.toLowerCase(),
      }))
      .filter((item) => item.text.length >= 1 && item.text.length <= 1500);
    const last = messageElements.at(-1);
    if (!last || /(outgoing|sent|self|mine|from-me|right)/.test(last.hint)) return null;
    const heading = [...document.querySelectorAll('main h1, main h2, header h1, header h2, [role="heading"]')]
      .filter(visible)
      .map((element) => (element.textContent || '').trim())
      .find((text) => text && text.length <= 40);
    if (!heading) return null;
    const profileUrl = [...document.querySelectorAll('a[href]')]
      .filter(visible)
      .map((anchor) => {
        const url = new URL(anchor.href, location.href);
        const hint = `${url.pathname} ${anchor.getAttribute('aria-label') ?? ''} ${anchor.textContent ?? ''}`.toLowerCase();
        return url.origin === location.origin && /(profile|member|user|account|プロフィール)/.test(hint) ? url.href : null;
      })
      .find(Boolean);
    return {
      displayName: heading,
      conversationExternalReference: location.pathname,
      threadUrl: location.href,
      profileUrl,
      body: last.text,
      sourceReliability,
    };
  }, reliability);
}

export async function clickLike(browser) {
  return browser.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 32 && rect.height >= 32 && style.visibility !== 'hidden' && style.display !== 'none' && !element.disabled;
    };
    const candidates = [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .map((element) => ({ element, label: (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim().toLowerCase() }))
      .filter(({ label }) => /^(いいね|like|♡|❤|♥)$/.test(label) && !/super|スーパー/.test(label));
    if (candidates.length !== 1) return { ok: false, reason: `like_button_count:${candidates.length}` };
    candidates[0].element.click();
    return { ok: true };
  });
}

export async function openBlockAction(browser) {
  return browser.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 24 && rect.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none' && !element.disabled;
    };
    const labelOf = (element) => (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim().normalize('NFKC').toLowerCase();
    const controls = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')].filter(visible);
    const blockActions = controls.filter((element) => /^(ブロック|ブロックする|block|block user)$/.test(labelOf(element)));
    if (blockActions.length === 1) {
      blockActions[0].click();
      return { ok: true, stage: 'block_clicked' };
    }
    if (blockActions.length > 1) return { ok: false, reason: `block_button_count:${blockActions.length}` };
    const menus = controls.filter((element) => /^(その他|メニュー|more|more options|…|⋮)$/.test(labelOf(element)));
    if (menus.length !== 1) return { ok: false, reason: `block_menu_count:${menus.length}` };
    menus[0].click();
    return { ok: true, stage: 'menu_opened' };
  });
}

export async function confirmBlockAction(browser) {
  return browser.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 24 && rect.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none' && !element.disabled;
    };
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog')].filter(visible);
    if (dialogs.length === 0) return { ok: true, stage: 'no_confirmation_required' };
    if (dialogs.length !== 1) return { ok: false, reason: `block_dialog_count:${dialogs.length}` };
    const confirmations = [...dialogs[0].querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .filter((element) => /^(ブロックする|はい|確認|confirm|block|block user)$/.test((element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim().normalize('NFKC').toLowerCase()));
    if (confirmations.length !== 1) return { ok: false, reason: `block_confirm_count:${confirmations.length}` };
    confirmations[0].click();
    return { ok: true, stage: 'confirmed' };
  });
}

export async function sendChatMessage(browser, body) {
  return browser.evaluate((message) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 80 && rect.height >= 24 && style.visibility !== 'hidden' && style.display !== 'none' && !element.disabled;
    };
    const editors = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')].filter(visible);
    if (editors.length !== 1) return { ok: false, reason: `message_editor_count:${editors.length}` };
    const editor = editors[0];
    editor.focus();
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
      const prototype = editor instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(editor, message);
    } else {
      editor.textContent = message;
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    const sendButtons = [...document.querySelectorAll('button, [role="button"]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 32 && rect.height >= 32 && !element.disabled;
      })
      .filter((element) => /^(送信|send|送る)$/.test((element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim().toLowerCase()));
    if (sendButtons.length !== 1) return { ok: false, reason: `send_button_count:${sendButtons.length}` };
    sendButtons[0].click();
    return { ok: true };
  }, body);
}
