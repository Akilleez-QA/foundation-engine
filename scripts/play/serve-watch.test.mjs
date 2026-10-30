// Only the interactive play server watches files. play:snap, play:script, play:criteria and the browser checks are
// short non-interactive runs: a file watcher there only spends the machine's inotify watches (a fresh clone once hit the
// limit during play:snap).
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {serve} from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test(
  'serve: non-interactive servers start no file watcher; npm run play (watch: true) keeps it',
  {timeout: 60000},
  async () => {
    const quiet = await serve();
    try {
      assert.equal(quiet.watching, false);
    } finally {
      await quiet.close();
    }
    const live = await serve({watch: true});
    try {
      assert.equal(live.watching, true);
    } finally {
      await live.close();
    }
  },
);

test('serve: npm run play asks for watching; snap and script use the default', async () => {
  const {readFileSync} = await import('node:fs');
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(read('./play.mjs'), /serve\(\{[^}]*watch: true[^}]*\}\)/);
  for (const file of ['./snap.mjs', './script.mjs']) assert.doesNotMatch(read(file), /watch: true/, file);
});

test('the browser-check preload turns watching off in vite.config.ts unless ENGINE_WATCH is set', () => {
  const run = (extra, preload) => {
    const env = {...process.env, ...extra};
    if (!('ENGINE_WATCH' in extra)) delete env.ENGINE_WATCH;
    return execFileSync(
      process.execPath,
      [
        ...(preload ? ['-r', './scripts/silent-browser.cjs'] : []),
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "const c = (await import('./vite.config.ts')).default; console.log(JSON.stringify({env: process.env.ENGINE_WATCH ?? null, watch: c.server.watch === null ? 'off' : 'default'}))",
      ],
      {cwd: ROOT, env, encoding: 'utf8'},
    )
      .trim()
      .split('\n')
      .at(-1);
  };
  assert.deepEqual(JSON.parse(run({}, true)), {env: '0', watch: 'off'});
  assert.deepEqual(JSON.parse(run({ENGINE_WATCH: '1'}, true)), {env: '1', watch: 'default'});
  assert.deepEqual(JSON.parse(run({}, false)), {env: null, watch: 'default'});
});
