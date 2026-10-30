import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicBase, publicUrl} from './public-base';

test('a root-relative base is used as it is', () => {
  assert.equal(publicBase('/', 'https://host/sub/index.html'), '/');
  assert.equal(publicBase('/my-game', 'https://host/my-game/'), '/my-game/');
  assert.equal(publicUrl('/models/a.glb', '/my-game/', 'https://host/my-game/'), '/my-game/models/a.glb');
});

test('a relative base resolves against the page, so workers and media fetch the same file', () => {
  assert.equal(publicBase('./', 'https://host/sub/dir/index.html?x=1#scene/lab'), 'https://host/sub/dir/');
  assert.equal(publicUrl('models/a.glb', './', 'https://host/sub/dir/'), 'https://host/sub/dir/models/a.glb');
  assert.equal(
    publicUrl('/models/a.glb', '', 'https://html.itch.zone/html/123/index.html'),
    'https://html.itch.zone/html/123/models/a.glb',
  );
});

test('without a document a relative base stays relative', () => {
  assert.equal(publicBase('./', ''), './');
  assert.equal(publicUrl('sounds/a.ogg', './', ''), './sounds/a.ogg');
});

test('the default base under tsx is the site root', () => {
  assert.equal(publicBase(undefined, ''), '/');
});

test('a base on another site is refused', () => {
  assert.throws(() => publicBase('https://cdn.example/', ''), /path on this site/);
  assert.throws(() => publicBase('//cdn.example/', ''), /path on this site/);
});
