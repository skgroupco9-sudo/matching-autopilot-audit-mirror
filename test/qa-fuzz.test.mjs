import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { normalizeExtendedIdentityProfile } from '../lib/identity-profile-fields.ts';
import { normalizeCredentialLoginId, normalizeServiceLabel } from '../lib/service-credentials.ts';
import { normalizeUnicodeText, unicodeLength } from '../lib/unicode-text.ts';

const hostileSeeds = [
  '<script>alert(1)</script>',
  "'; DROP TABLE users; --",
  '../../../etc/passwd',
  'javascript:alert(document.cookie)',
  '🎌🔥💯 𠮷野家 𩸽',
  'A\u030A Å Ａ',
  '\u202Eadmin\u202C',
  '\u0000\u0007\ud800\udfff',
  '-1 NaN Infinity',
];

test('10,000 hostile and Unicode inputs remain bounded and well-formed', () => {
  let state = 0x1f2e3d4c;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };

  for (let index = 0; index < 10_000; index += 1) {
    const repetitions = 1 + Math.floor(random() * 120);
    const input = Array.from({ length: repetitions }, () => hostileSeeds[Math.floor(random() * hostileSeeds.length)]).join(String.fromCodePoint(32 + Math.floor(random() * 90)));
    const normalized = normalizeUnicodeText(input, 120);
    assert.ok(unicodeLength(normalized) <= 120);
    assert.equal(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(normalized), false);
    assert.equal(/[\uD800-\uDFFF]/u.test(Array.from(normalized).filter((character) => character.length === 1).join('')), false);
    assert.ok(unicodeLength(normalizeServiceLabel(input)) <= 80);
    assert.ok(unicodeLength(normalizeCredentialLoginId(input)) <= 254);

    const profile = normalizeExtendedIdentityProfile({
      legalName: input,
      nameKana: input,
      hometown: input,
      interests: input,
      personality: input,
      firstDatePreference: input,
    });
    assert.equal(profile.ok, true);
    if (profile.ok) {
      assert.ok(unicodeLength(profile.value.legalName) <= 80);
      assert.ok(unicodeLength(profile.value.interests) <= 300);
    }
  }
});

test('client API calls use the timeout and single-flight guard', async () => {
  const files = await findFiles(path.resolve('app'), (name) => name.endsWith('.tsx'));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('/api/')) continue;
    assert.equal(/\bfetch\s*\(/.test(source), false, `${path.relative(process.cwd(), file)} bypasses the guarded request layer`);
    if (source.includes('fetchWithTimeout(')) {
      assert.match(source, /useGuardedFetch/);
    }
  }
});

test('React pages contain no user-controlled raw HTML sink', async () => {
  const files = await findFiles(path.resolve('app'), (name) => name.endsWith('.tsx'));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.equal(source.includes('dangerouslySetInnerHTML'), false, `${path.relative(process.cwd(), file)} contains a raw HTML sink`);
    assert.equal(/\.innerHTML\s*=/.test(source), false, `${path.relative(process.cwd(), file)} assigns innerHTML`);
  }
});

test('every editable text control has an explicit client-side length limit', async () => {
  const files = await findFiles(path.resolve('app'), (name) => name.endsWith('.tsx'));
  const lengthExemptTypes = new Set(['checkbox', 'radio', 'file', 'range', 'date', 'datetime-local', 'time', 'color', 'hidden', 'number']);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        if (tagName === 'input' || tagName === 'textarea') {
          const attributes = new Map(node.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((attribute) => [attribute.name.getText(sourceFile), attribute]));
          const typeAttribute = attributes.get('type');
          const staticType = typeAttribute?.initializer && ts.isStringLiteral(typeAttribute.initializer)
            ? typeAttribute.initializer.text
            : 'text';
          const exempt = tagName === 'input' && (lengthExemptTypes.has(staticType) || attributes.has('readOnly'));
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          if (!exempt) assert.ok(attributes.has('maxLength'), `${path.relative(process.cwd(), file)}:${line + 1} has an unbounded ${tagName}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
});

async function findFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(target, predicate);
    return predicate(entry.name) ? [target] : [];
  }));
  return nested.flat();
}
