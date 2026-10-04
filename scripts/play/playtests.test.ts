// The gate runs the game's browser playtests (C7 of the 2026-10-03 acceptance: a gate passed while a game's S3 and S4
// playtests failed). These tests pin which scripts run, that a failing or malformed one fails, and the gate wiring.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT} from '../lib/game-dir.mjs';
import {scriptProblems} from './script-schema.mjs';
import {playtestFiles, runPlaytests} from './playtests';

const ok = {name: 'ok', steps: [{expect: {path: 'scene', equals: 'scene.main'}}]};

function game() {
  const root = mkdtempSync(join(tmpdir(), 'playtests-'));
  const dir = join(root, 'game');
  mkdirSync(join(dir, 'playtest'), {recursive: true});
  mkdirSync(join(root, 'checks'));
  writeFileSync(join(dir, 'playtest', 'b.json'), JSON.stringify({...ok, name: 'b'}));
  writeFileSync(join(dir, 'playtest', 'a.json'), JSON.stringify({...ok, name: 'a'}));
  writeFileSync(join(dir, 'playtest', 'notes.txt'), 'not a script');
  writeFileSync(join(root, 'checks', 'c.json'), JSON.stringify({...ok, name: 'c'}));
  return {root, dir};
}

test('every playtest/*.json and every playtest criterion runs once, with the criteria it checks', () => {
  const {root, dir} = game();
  try {
    const files = playtestFiles(dir, [
      {id: 'S1', how: 'test', by: 'game/x.test.ts'},
      {id: 'S3', how: 'playtest', by: 'game/playtest/b.json'},
      {id: 'S4', how: 'playtest', by: 'game/playtest/b.json'},
      {id: 'S5', how: 'playtest', by: 'checks/c.json'},
      {id: 'S6', how: 'gate'},
    ]);
    assert.deepEqual(
      files.map(f => [f.file.split('/').slice(-2).join('/'), f.criteria]),
      [
        ['checks/c.json', ['S5']],
        ['playtest/a.json', []],
        ['playtest/b.json', ['S3', 'S4']],
      ],
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a failing playtest fails, and a malformed or missing script fails without a browser', async () => {
  const {root, dir} = game();
  try {
    writeFileSync(join(dir, 'playtest', 'bad.json'), JSON.stringify({name: 'bad', steps: [{fly: 1}]}));
    const files = [
      ...playtestFiles(dir, [{id: 'S3', how: 'playtest', by: 'game/playtest/b.json'}]),
      {file: 'no/such/file.json', criteria: ['S9']},
    ];
    const ran: string[] = [];
    let servers = 0;
    const results = await runPlaytests(files, {
      url: async () => {
        servers++;
        return 'http://127.0.0.1:1';
      },
      run: async script => {
        ran.push(script.name);
        return script.name === 'b'
          ? {name: 'b', pass: false, steps: [{step: {expect: {}}, ok: false}], errors: []}
          : {name: script.name, pass: true, steps: [{step: {}, ok: true}]};
      },
      problems: scriptProblems,
    });
    assert.deepEqual(ran, ['a', 'b']);
    assert.ok(servers >= 1);
    const by = Object.fromEntries(results.map(r => [r.file.split('/').pop(), r]));
    assert.equal(by['a.json']?.pass, true);
    assert.equal(by['b.json']?.pass, false);
    assert.deepEqual(by['b.json']?.criteria, ['S3']);
    assert.match(by['b.json']?.detail ?? '', /1 failing step/);
    assert.equal(by['bad.json']?.pass, false);
    assert.equal(by['file.json']?.pass, false);
    assert.match(by['file.json']?.detail ?? '', /cannot read/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('the gate runs play:playtests after the smoke snap and fails on it', () => {
  const gate = readFileSync(join(ROOT, 'scripts/perf/gate.mjs'), 'utf8');
  const snap = gate.indexOf("step('play:snap'");
  const playtests = gate.indexOf("step('play:playtests', toolCommand('tsx', ['scripts/play/playtests.ts']))");
  assert.ok(snap > 0 && playtests > snap, 'gate.mjs runs scripts/play/playtests.ts after play:snap');
  // step() records every non-zero exit as a gate failure.
  assert.match(gate, /if \(!ok\) fail\.push\(name\)/);
});

test('every template playtest script is found for the template gates', () => {
  for (const [t, want] of [
    ['arcade', ['best-reload.json', 'restart.json']],
    ['explorer', ['door.json']],
    ['learn', ['lesson.json']],
  ] as const) {
    const files = playtestFiles(join(ROOT, 'templates', t, 'game'), []).map(f => f.file.split('/').pop());
    assert.deepEqual(files, want, t);
  }
});
