// PUX-001 の回帰テスト。
// app/globals.css の実際の宣言を読み、WCAG 2.1 の相対輝度式でコントラスト比を計算する。
// 目視ではなく数値で固定し、色を変更したときに気付けるようにする。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

function ruleBody(selector) {
  // コメントを除去したうえで、宣言ブロックのみを取り出す
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const index = stripped.indexOf(`\n${selector} {`);
  assert.notEqual(index, -1, `${selector} が app/globals.css に存在しない`);
  const start = stripped.indexOf('{', index);
  return stripped.slice(start + 1, stripped.indexOf('}', start));
}

function declaration(body, property) {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm').exec(body);
  assert.ok(match, `${property} の宣言が見つからない`);
  return match[1].trim();
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  let value = hex.replace('#', '').trim();
  if (value.length === 3) value = [...value].map((c) => c + c).join('');
  assert.match(value, /^[0-9a-fA-F]{6}$/, `16進表記ではない: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('1. コントラスト計算がWCAGの既知の値と一致する', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(Math.round(contrast('#ffffff', '#ffffff') * 100) / 100, 1);
  // 修正前の組み合わせ。AAを満たさないことを数値で残す
  assert.ok(contrast('#ffffff', '#cbd3dd') < 2, '#fff on #cbd3dd は 2:1 未満');
});

test('2. 無効時の主ボタンのラベルが WCAG AA (4.5:1) を満たす', () => {
  const body = ruleBody('.primary-button:disabled');
  const ratio = contrast(declaration(body, 'color'), declaration(body, 'background'));
  assert.ok(ratio >= 4.5, `.primary-button:disabled のコントラストは ${ratio.toFixed(2)}:1`);
});

test('3. 有効時の主ボタンと補助ボタンも AA を満たす', () => {
  const tokens = ruleBody(':root');
  const navy = declaration(tokens, '--navy');
  const primary = ruleBody('.primary-button');
  assert.equal(declaration(primary, 'background'), 'var(--navy)');
  assert.ok(contrast(declaration(primary, 'color'), navy) >= 4.5, '有効時の主ボタン');

  const secondary = ruleBody('.secondary-button');
  assert.ok(contrast(declaration(secondary, 'color'), declaration(secondary, 'background')) >= 4.5, '補助ボタン');
});

test('4. テキストボタンの文字色が白背景に対して AA を満たす', () => {
  const body = ruleBody('.text-button');
  assert.ok(contrast(declaration(body, 'color'), '#ffffff') >= 4.5);
});
