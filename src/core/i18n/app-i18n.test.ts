import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {must} from '../../testing/must';

const repo = new URL('../../../', import.meta.url).pathname;

/** A generated narration catalogue from a throwaway shard tree (the repo copy is gitignored and may be absent). */
function generatedNarration(lines: Record<string, string>): Record<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'engine-app-i18n-'));
  try {
    const shard = path.join(dir, 'src/features/demo/narration');
    mkdirSync(shard, {recursive: true});
    writeFileSync(path.join(shard, 'en.json'), JSON.stringify(lines));
    const r = spawnSync(
      process.execPath,
      [
        path.join(repo, 'scripts/strings.mjs'),
        '--root',
        dir,
        '--out',
        path.join(dir, 'keys.gen.ts'),
        '--narration-out',
        path.join(dir, 'narration.json'),
        '--ids-out',
        path.join(dir, 'ids.json'),
      ],
      {encoding: 'utf8'},
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(readFileSync(path.join(dir, 'narration.json'), 'utf8'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

test('the game instance fetches the narration catalogue once and then renders every line exactly as authored', async () => {
  const lines = {welcome: 'Welcome in. Take a look around.', 'tour-gate-0': 'This is the gate.'};
  const catalog = generatedNarration(lines);
  assert.deepEqual(catalog, {'narration.welcome': lines.welcome, 'narration.tour-gate-0': lines['tour-gate-0']});
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: URL | string) => {
    asked.push(String(url));
    return new Response(JSON.stringify(catalog));
  }) as typeof fetch;
  try {
    const {narrationCatalog, narrationLine, hasNarrationLine} = await import('./app-i18n');
    assert.equal(hasNarrationLine('welcome'), false, 'nothing is known before the catalogue loads');
    assert.equal(narrationLine('welcome'), '');
    await Promise.all([narrationCatalog.load(), narrationCatalog.load()]);
    assert.equal(asked.length, 1);
    assert.match(must(asked[0], 'the fetched URL'), /\/generated\/strings\/en\/narration\.json$/);
    for (const [key, text] of Object.entries(lines)) assert.equal(narrationLine(key), text, key);
    assert.equal(hasNarrationLine('no-such-line'), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
