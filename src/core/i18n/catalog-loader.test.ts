import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogLoader} from './catalog-loader';
import {createI18n} from './i18n';
import {must} from '../../testing/must';

type P = Record<'narration.hello', never>;

test('a catalogue loads once, lands in the i18n instance, and lookups are then synchronous', async () => {
  const i18n = createI18n<P>({locale: 'en', catalogs: {en: {}}});
  let fetches = 0;
  const loader = createCatalogLoader(i18n, 'en', async () => {
    fetches++;
    return {'narration.hello': 'Hello, player.'};
  });
  assert.equal(loader.loaded(), false);
  assert.equal(i18n.has('narration.hello'), false);
  await Promise.all([loader.load(), loader.load()]);
  await loader.load();
  assert.equal(fetches, 1);
  assert.equal(loader.loaded(), true);
  assert.equal(i18n.t('narration.hello'), 'Hello, player.');
});

test('a failed load is retried by the next call, and a malformed catalogue is a failure', async () => {
  const i18n = createI18n<P>({locale: 'en', catalogs: {en: {}}});
  const answers: (() => unknown)[] = [
    () => {
      throw new Error('offline');
    },
    () => ['not', 'a', 'catalogue'],
    () => ({'narration.hello': 'Hi.'}),
  ];
  let fetches = 0;
  const loader = createCatalogLoader(
    i18n,
    'en',
    async () => must(answers[fetches++], 'a scripted answer')() as Record<string, string>,
  );
  await assert.rejects(loader.load(), /offline/);
  assert.equal(loader.loaded(), false);
  await assert.rejects(loader.load(), /not an object/);
  assert.equal(loader.loaded(), false);
  await loader.load();
  assert.equal(fetches, 3);
  assert.equal(i18n.t('narration.hello'), 'Hi.');
});
