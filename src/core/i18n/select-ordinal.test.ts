import test from 'node:test';
import assert from 'node:assert/strict';
import { createI18n, localeChain, MAX_LOCALE_CHAIN, MESSAGE_LIMITS, messageVars, parseMessage, renderMessage } from './index';

test('select picks the case by the value, then other; nested plurals keep their number', () => {
  interface P { 'x.left': { who: string | number; n: number } }
  const msg = '{who, select, she {She left # {n, plural, one {gift} other {gifts}}} he {He left} other {They left}}';
  const i = createI18n<P>({ locale: 'en', catalogs: { en: { 'x.left': msg } } });
  assert.equal(i.t('x.left', { who: 'she', n: 1 }), 'She left # gift');
  assert.equal(i.t('x.left', { who: 'he', n: 3 }), 'He left');
  assert.equal(i.t('x.left', { who: 'unknown', n: 3 }), 'They left');
  assert.equal(i.t('x.left', { who: '', n: 3 }), 'They left');
  // Prototype names are never cases unless authored.
  assert.equal(i.t('x.left', { who: 'constructor', n: 3 }), 'They left');
  assert.deepEqual([...messageVars(parseMessage(msg))], [['who', 'text'], ['n', 'number']]);
});

test('selectordinal uses the ordinal plural rules of the resolved locale', () => {
  interface P { 'x.rank': { n: number } }
  const en = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
  const i = createI18n<P>({ locale: 'en', catalogs: { en: { 'x.rank': en } } });
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 1002].map(n => i.t('x.rank', { n })),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '1,002nd']);
  // An exact form wins over the category; the cardinal plural of the same number differs.
  const exact = parseMessage('{n, selectordinal, =1 {first} one {#st} other {#th}}');
  assert.equal(renderMessage(exact, { n: 1 }, 'en'), 'first');
  assert.equal(renderMessage(exact, { n: 21 }, 'en'), '21st');
  assert.equal(renderMessage(parseMessage('{n, plural, one {#st} other {#th}}'), { n: 21 }, 'en'), '21th');
  assert.deepEqual([...messageVars(exact)], [['n', 'number']]);
});

test('the parser rejects unknown plural categories, missing other, bad cases and oversize or deep messages', () => {
  assert.throws(() => parseMessage('{n, plural, once {x} other {y}}'), /Unknown plural category/);
  assert.throws(() => parseMessage('{n, selectordinal, one {x}}'), /needs an "other"/);
  assert.throws(() => parseMessage('{g, select, a {x}}'), /needs an "other"/);
  assert.throws(() => parseMessage('{g, select, a {x} a {y} other {z}}'), /Duplicate select case/);
  assert.throws(() => parseMessage('x'.repeat(MESSAGE_LIMITS.maxLength + 1)), /longer than/);
  let deep = 'x';
  for (let d = 0; d <= MESSAGE_LIMITS.maxDepth; d++) deep = `{g, select, other {${deep}}}`;
  assert.throws(() => parseMessage(deep), /nested deeper/);
  let ok = 'x';
  for (let d = 0; d < MESSAGE_LIMITS.maxDepth; d++) ok = `{g, select, other {${ok}}}`;
  assert.equal(renderMessage(parseMessage(ok), {}, 'en'), 'x');
  assert.throws(() => parseMessage('{a}'.repeat(MESSAGE_LIMITS.maxParts + 1)), /parts/);
  assert.throws(() => parseMessage(42 as unknown as string), TypeError);
});

test('rendering with an unsupported locale tag falls back to en rules instead of throwing', () => {
  const parts = parseMessage('{n, plural, one {# item} other {# items}}');
  assert.equal(renderMessage(parts, { n: 2 }, 'not a locale!'), '2 items');
});

test('locale chain: explicit fallbacks, then truncation, then base; bounded and deduplicated', () => {
  assert.deepEqual(localeChain('pt-BR', 'en'), ['pt-BR', 'pt', 'en']);
  assert.deepEqual(localeChain('en', 'en'), ['en']);
  assert.deepEqual(localeChain('zh-Hant-TW', 'en'), ['zh-Hant-TW', 'zh-Hant', 'zh', 'en']);
  assert.deepEqual(localeChain('es-MX', 'en', { 'es-MX': ['es-419'] }), ['es-MX', 'es-419', 'es', 'en']);
  assert.deepEqual(localeChain('de-x-test', 'en'), ['de-x-test', 'de', 'en']);
  const many = Array.from({ length: 50 }, (_, k) => `x${k}`);
  const chain = localeChain('aa-BB-CC-DD-EE-FF-GG-HH-II', 'en', { 'aa-BB-CC-DD-EE-FF-GG-HH-II': many });
  assert.equal(chain.length, MAX_LOCALE_CHAIN);
  assert.equal(chain.at(-1), 'en');
});

test('t() follows the chain per key and pluralises with the locale that supplied the text', () => {
  interface P { 'x.a': never; 'x.b': never; 'x.n': { n: number } }
  const missing: string[] = [];
  const i = createI18n<P>({
    locale: 'pt-BR', baseLocale: 'en', onMissing: k => missing.push(k),
    catalogs: {
      en: { 'x.a': 'A', 'x.b': 'B', 'x.n': '{n, plural, one {# file} other {# files}}' },
      pt: { 'x.b': 'B-pt', 'x.n': '{n, plural, one {# arquivo} other {# arquivos}}' },
      'pt-BR': { 'x.a': 'A-br' },
    },
  });
  assert.deepEqual(i.localeChain(), ['pt-BR', 'pt', 'en']);
  assert.equal(i.t('x.a'), 'A-br');
  assert.equal(i.t('x.b'), 'B-pt');
  // pt (and pt-BR) treat 0 as "one"; en would say "0 files".
  assert.equal(i.t('x.n', { n: 0 }), '0 arquivo');
  i.setLocale('fr-CA');
  assert.deepEqual(i.localeChain(), ['fr-CA', 'fr', 'en']);
  assert.equal(i.t('x.b'), 'B');
  assert.deepEqual(missing, []);
});
