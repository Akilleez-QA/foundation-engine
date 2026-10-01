import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { gameFiles, loadGameDefinitions } from './game-files';
import { bodyOf } from '../author/body';
import type { SceneDefinition } from '../author/defs';

test('discovery preserves legacy definitions and helpers without evaluating opt-in lazy bodies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundation-lazy-body-'));
  const key = `lazy-body:${dir}`;
  const state = globalThis as unknown as Record<string, { helper: number; body: number }>;
  state[key] = { helper: 0, body: 0 };
  const write = (path: string, source: string) => writeFileSync(join(dir, path), source);
  try {
    write('package.json', '{"type":"module"}');
    mkdirSync(join(dir, 'nested'));
    write('helper.ts', `globalThis[${JSON.stringify(key)}].helper++; export const helper = true;`);
    write('scene.ts', `export default { kind: 'scene', id: 'lazy', entities: [], body: () => import('./content.body.mts') };`);
    write('nested/legacy.ts', `export default { kind: 'input', id: 'legacy' };`);
    write('content.body.mts', `globalThis[${JSON.stringify(key)}].body++; export default { entities: [], systems: [{id:'loaded',run(){}}] };`);
    for (const file of ['build.brief.ts', 'game.ts', 'ignored.test.ts']) write(file, `throw Error('excluded file evaluated');`);
    assert.deepEqual(gameFiles(dir).map(file => relative(dir, file)), ['helper.ts', 'nested/legacy.ts', 'scene.ts']);

    const definitions = await loadGameDefinitions(dir);
    assert.deepEqual(definitions.map(def => def.id).sort(), ['lazy', 'legacy']);
    assert.deepEqual(state[key], { helper: 1, body: 0 }, 'discovery keeps helper evaluation but leaves lazy content untouched');
    const scene = definitions.find(def => def.kind === 'scene') as SceneDefinition;
    const body = await bodyOf(scene);
    assert.equal(body.systems[0]?.id, 'loaded');
    assert.deepEqual(state[key], { helper: 1, body: 1 });
    assert.equal((await bodyOf(scene)).systems[0], body.systems[0], 'normal module caching is preserved');
    assert.equal(state[key].body, 1);
  } finally {
    delete state[key];
    rmSync(dir, { recursive: true, force: true });
  }
});
