import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {AssetDef} from '../../core/asset-def.ts';
import {assetUrl, urlVariant} from './url.ts';

const line: AssetDef = {
  id: 'asset.narration.x',
  kind: 'narration',
  title: 'x',
  licence: 'original',
  provenance: {},
  variants: [
    {path: 'audio/narration/brave/x.mp3', format: 'mp3', voice: 'brave'},
    {path: 'audio/narration/curious/x.mp3', format: 'mp3', voice: 'curious'},
  ],
};

test('url() picks the variant for the voice and prefixes the public root', () => {
  assert.equal(assetUrl(line, {voice: 'curious'}), '/audio/narration/curious/x.mp3');
  assert.equal(assetUrl(line), '/audio/narration/brave/x.mp3');
  assert.equal(assetUrl(line, {voice: 'brave'}, '/base/'), '/base/audio/narration/brave/x.mp3');
});

test('url() throws for a voice the row does not have; a locale it lacks falls back to en', () => {
  assert.throws(() => urlVariant(line, {voice: 'dramatic'}), /asset\.narration\.x: no variant/);
  assert.equal(assetUrl(line, {voice: 'curious', locale: 'fr'}), '/audio/narration/curious/x.mp3');
  assert.throws(
    () => urlVariant({...line, variants: [{path: 'a/fr.mp3', format: 'mp3', locale: 'fr'}]}, {locale: 'de'}),
    /no variant/,
  );
});
