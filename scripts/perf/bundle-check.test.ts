import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBundle, chunkName } from './bundle-check';

function fixture(files: Record<string, number>, manifest: object) {
  const dir = mkdtempSync(join(tmpdir(), 'engine-bundle-test-'));
  mkdirSync(join(dir, '.vite'), { recursive: true }); mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const [f, n] of Object.entries(files)) writeFileSync(join(dir, f), Buffer.alloc(n));
  writeFileSync(join(dir, '.vite', 'manifest.json'), JSON.stringify(manifest));
  return dir;
}
const manifest = {
  'index.html': { file: 'assets/index-AAAAAAAA.js', isEntry: true, imports: ['_shared'], dynamicImports: ['src/scene.ts'] },
  _shared: { file: 'assets/shared-BBBBBBBB.js' },
  'src/scene.ts': { file: 'assets/scene-CCCCCCCC.js', src: 'src/scene.ts' },
};

test('first-load JS is the entry and its static imports only; dynamic imports are not first load', () => {
  const dir = fixture({ 'assets/index-AAAAAAAA.js': 100 * 1024, 'assets/shared-BBBBBBBB.js': 20 * 1024, 'assets/scene-CCCCCCCC.js': 900 * 1024 }, manifest);
  try {
    const r = checkBundle(dir, 200, ['scene']);
    assert.equal(r.firstLoadJsKiB, 120);
    assert.deepEqual(r.firstLoadFiles, ['assets/index-AAAAAAAA.js', 'assets/shared-BBBBBBBB.js']);
    assert.equal(r.ok, true, r.text);
    const over = checkBundle(dir, 100, ['scene']);
    assert.equal(over.ok, false);
    assert.match(over.text, /first-load JS 120 KiB is over its 100 KiB budget/);
    const large = checkBundle(dir, 200, []);
    assert.match(large.problems.join(), /scene-CCCCCCCC\.js is 922 kB/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('chunk names drop the content hash', () => assert.equal(chunkName('assets/index-B8Nffy8n.js'), 'index'));
