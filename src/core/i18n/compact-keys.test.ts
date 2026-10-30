import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactCatalog, compactProblems, compactSource} from '../../../scripts/compact-keys.mjs';
import {compactId} from '../../../scripts/strings.mjs';

const ids = {'shell.map.zoom-in': 'a', 'shell.map.title-team': 'b'};

test('compact ids are short, unique identifiers', () => {
  const seen = new Set<string>();
  for (let n = 0; n < 4000; n++) {
    const id = compactId(n);
    assert.match(id, /^[A-Za-z][A-Za-z0-9]*$/);
    assert.ok(!seen.has(id), id);
    seen.add(id);
  }
  assert.equal(compactId(0), 'a');
  assert.equal(compactId(51), 'Z');
  assert.equal(compactId(52).length, 2);
});

test('only whole quoted keys (and detailed variants) become ids, in source and in shards', () => {
  assert.equal(
    compactSource(
      `t('shell.map.zoom-in');t("shell.map.title-team",{team});x=\`shell.map.zoom-in\`;t('shell.map.zoom-in@detailed')`,
      ids,
    ),
    `t('a');t("b",{team});x=\`a\`;t('a@detailed')`,
  );
  assert.equal(
    compactSource(`add({id:'shell.map',x:'shell.map.zoom-inx','shell.level':1})`, ids),
    `add({id:'shell.map',x:'shell.map.zoom-inx','shell.level':1})`,
  );
  assert.equal(
    compactCatalog('{"shell.map.zoom-in":"Zoom in","shell.map.title-team@detailed":"{team} path"}', ids),
    '{"a":"Zoom in","b@detailed":"{team} path"}',
  );
  assert.throws(() => compactCatalog('{"shell.unknown":"?"}', ids), /shell\.unknown/);
});

test('a shipped readable key or a composed key is a build error', () => {
  assert.deepEqual(compactProblems(`t("a");t("b")`, ids), []);
  assert.deepEqual(compactProblems(`t("shell.map.zoom-in")`, ids), ['readable key "shell.map.zoom-in"']);
  assert.equal(compactProblems('t(`shell.map.${k}`)', ids).length, 1);
});

test('production compacts module-local shards together with their call sites', async () => {
  const {compactKeys} = await import('../../../scripts/compact-keys.mjs');
  const {mkdtempSync, writeFileSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'engine-compact-'));
  try {
    const file = join(root, 'ids.json');
    writeFileSync(file, JSON.stringify(ids));
    const plugin = compactKeys(file) as {
      configResolved(config: {mode: string}): void;
      transform(code: string, id: string): {code: string} | null;
    };
    plugin.configResolved({mode: 'production'});
    const catalog = plugin.transform(
      '{"shell.map.zoom-in":"Zoom in"}',
      join(root, 'src/features/home/strings/map/en.json'),
    );
    assert.equal(catalog?.code, '{"a":"Zoom in"}');
    assert.equal(
      plugin.transform('{"shell.map.zoom-in":"Zoom in"}', join(root, 'src/platform/ui/strings/shell/en.json'))?.code,
      '{"a":"Zoom in"}',
    );
    assert.equal(plugin.transform(`t('shell.map.zoom-in')`, join(root, 'src/home-map.ts'))?.code, `t('a')`);
    plugin.configResolved({mode: 'test'});
    assert.equal(
      plugin.transform('{"shell.map.zoom-in":"Zoom in"}', join(root, 'src/features/home/strings/map/en.json')),
      null,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
