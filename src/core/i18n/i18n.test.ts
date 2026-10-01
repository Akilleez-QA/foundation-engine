import test from 'node:test';
import assert from 'node:assert/strict';
import { createI18n, parseMessage, messageVars } from './index';

/** Stands in for the generated keys.gen.ts. */
interface Params {
  'shell.map.open': never;
  'receipt.tickets': { n: number; total: string | number };
  'panel.exit': { panel: string | number };
  'shell.nested': { n: number; who: string | number };
}
const en = {
  'shell.map.open': '⌖ Map & travel',
  'receipt.tickets': '🎟 +{n, plural, one {# ticket} other {# tickets}} for exploring! You have {total}.',
  'panel.exit': 'Back to the {panel}',
  'panel.exit@detailed': 'Return to {panel}',
  'shell.nested': '{n, plural, =0 {Nobody} one {{who} alone} other {{who} and # friends}}',
};

test('t() fills variables and picks plural forms with the locale rules', () => {
  const i = createI18n<Params>({ locale: 'en', catalogs: { en } });
  assert.equal(i.t('shell.map.open'), '⌖ Map & travel');
  assert.equal(i.t('receipt.tickets', { n: 1, total: 4 }), '🎟 +1 ticket for exploring! You have 4.');
  assert.equal(i.t('receipt.tickets', { n: 1200, total: 1201 }), '🎟 +1,200 tickets for exploring! You have 1201.');
  assert.equal(i.t('shell.nested', { n: 0, who: 'Pip' }), 'Nobody');
  assert.equal(i.t('shell.nested', { n: 1, who: 'Pip' }), 'Pip alone');
  assert.equal(i.t('shell.nested', { n: 3, who: 'Pip' }), 'Pip and 3 friends');
});

test('reading levels are key variants: standard by default, detailed from the i18n level or per call', () => {
  const i = createI18n<Params>({ locale: 'en', catalogs: { en } });
  assert.equal(i.t('panel.exit', { panel: 'workshop' }), 'Back to the workshop');
  assert.equal(i.t('panel.exit', { panel: 'workshop' }, { level: 'detailed' }), 'Return to workshop');
  i.setLevel('detailed');
  assert.equal(i.level(), 'detailed');
  assert.equal(i.t('panel.exit', { panel: 'gallery' }), 'Return to gallery');
  // A key without a detailed variant reads its standard text at either level.
  assert.equal(i.t('shell.map.open'), '⌖ Map & travel');
});

test('a key missing in a locale falls back per key to en; an unknown key reports and shows the owner fallback', () => {
  const missing: string[] = [];
  const i = createI18n<Params & { 'shell.gone': never }>({ locale: 'fr', catalogs: { en, fr: { 'panel.exit': 'Retour à {panel}' } }, onMissing: (k, l) => missing.push(l + ':' + k) });
  assert.equal(i.t('panel.exit', { panel: 'musée' }), 'Retour à musée');
  assert.equal(i.t('receipt.tickets', { n: 2, total: 2 }), '🎟 +2 tickets for exploring! You have 2.');
  assert.equal(i.has('shell.gone'), false);
  assert.equal(i.t('shell.gone', undefined, { fallback: 'Map' }), 'Map');
  assert.equal(i.t('shell.gone'), 'shell.gone');
  assert.deepEqual(missing, ['fr:shell.gone', 'fr:shell.gone']);
  i.addCatalog('fr', { 'shell.map.open': '⌖ Carte' });
  assert.equal(i.t('shell.map.open'), '⌖ Carte');
  i.setLocale('en');
  assert.equal(i.t('shell.map.open'), '⌖ Map & travel');
});

test('plural categories come from Intl.PluralRules for the locale', () => {
  interface P { 'x.apples': { n: number } }
  const msg = '{n, plural, one {# jabłko} few {# jabłka} many {# jabłek} other {# jabłka}}';
  const i = createI18n<P>({ locale: 'pl', catalogs: { en: { 'x.apples': '{n, plural, one {# apple} other {# apples}}' }, pl: { 'x.apples': msg } } });
  assert.deepEqual([1, 2, 5, 22].map(n => i.t('x.apples', { n })), ['1 jabłko', '2 jabłka', '5 jabłek', '22 jabłka']);
});

test('the message parser rejects malformed text and reports each variable once with its kind', () => {
  assert.throws(() => parseMessage('Hello {name'), /Unclosed|Expected/);
  assert.throws(() => parseMessage('Hello }'), /Unexpected/);
  assert.throws(() => parseMessage('{n, plural, one {x}}'), /other/);
  assert.deepEqual([...messageVars(parseMessage(en['shell.nested']))], [['n', 'number'], ['who', 'text']]);
  assert.deepEqual([...messageVars(parseMessage(en['receipt.tickets']))], [['n', 'number'], ['total', 'text']]);
});

test('t() arguments are typed per key', () => {
  const i = createI18n<Params>({ locale: 'en', catalogs: { en } });
  // @ts-expect-error a key with variables needs them
  i.t('panel.exit');
  // @ts-expect-error a missing variable is a type error
  i.t('receipt.tickets', { n: 1 });
  // @ts-expect-error an unknown key is a type error
  i.t('shell.nope');
  assert.ok(true);
});

test('literal messages preserve text, levels and replacement without bypassing brace validation', () => {
 const literal="🐔 #1's route\n <b>Map & travel</b>";
 const i=createI18n<Record<string,never>>({locale:'fr',catalogs:{en:{label:literal,'label@detailed':'Detailed #1',empty:''}}});
 assert.equal(i.t('label'),literal);assert.equal(i.t('empty'),'');
 assert.equal(i.t('label',undefined,{level:'detailed'}),'Detailed #1');
 i.addCatalog('fr',{label:'Trajet 🐔'});assert.equal(i.t('label'),'Trajet 🐔');
 i.addCatalog('fr',{label:'Updated'});assert.equal(i.t('label'),'Updated');
 for(const malformed of ['unclosed {name','unexpected }']){
  i.addCatalog('fr',{label:malformed});assert.throws(()=>i.t('label'));
 }
});
