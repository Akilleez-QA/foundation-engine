// Learn mode costs nothing until a lesson opens: the learn runtime (director, chalkboard, concept explorer) is never in
// the first-load bundle. A game without the learn kit ships none of it; the learn template ships it only in lazy
// chunks. Builds each template with Vite into a temporary folder and reads its manifest.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {toolCommand} from '../lib/tool.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MARKERS = ['learn-director', 'learnKit'];
type Chunk = {file: string; isEntry?: boolean; imports?: string[]};

function build(template: string) {
  const out = mkdtempSync(join(tmpdir(), `engine-${template}-`));
  const vite = toolCommand('vite', ['build', '--outDir', out, '--emptyOutDir', '--manifest', '--logLevel', 'error']);
  const r = spawnSync(vite.command, vite.args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: vite.shell,
    env: {...process.env, GAME_DIR: `templates/${template}/game`},
  });
  assert.equal(
    r.status,
    0,
    `Vite build ${template}: status=${r.status}, signal=${r.signal}, error=${r.error?.message ?? 'none'}\n${r.stderr}`,
  );
  const manifest = JSON.parse(readFileSync(join(out, '.vite', 'manifest.json'), 'utf8')) as Record<string, Chunk>;
  const first = new Set<string>();
  const walk = (key: string) => {
    const c = manifest[key];
    if (!c || first.has(c.file)) return;
    first.add(c.file);
    for (const i of c.imports ?? []) walk(i);
  };
  for (const [key, c] of Object.entries(manifest)) if (c.isEntry) walk(key);
  const js = readdirSync(join(out, 'assets'))
    .filter(f => f.endsWith('.js'))
    .map(f => `assets/${f}`);
  const text = (f: string) => readFileSync(join(out, f), 'utf8');
  return {out, first: [...first], lazy: js.filter(f => !first.has(f)), text};
}
const hasLearn = (s: string) => MARKERS.some(m => s.includes(m));

test('learn isolation: the learn template loads the learn runtime lazily; a game without the kit ships none of it', () => {
  const learn = build('learn');
  try {
    assert.deepEqual(
      learn.first.filter(f => hasLearn(learn.text(f))),
      [],
      'no learn runtime in the first-load bundle',
    );
    assert.ok(
      learn.lazy.some(f => hasLearn(learn.text(f))),
      'the learn runtime is in a lazy chunk',
    );
  } finally {
    rmSync(learn.out, {recursive: true, force: true});
  }
  const arcade = build('arcade');
  try {
    assert.deepEqual(
      [...arcade.first, ...arcade.lazy].filter(f => hasLearn(arcade.text(f))),
      [],
    );
  } finally {
    rmSync(arcade.out, {recursive: true, force: true});
  }
});
