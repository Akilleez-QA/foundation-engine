#!/usr/bin/env node
// scripts/play/script.mjs (`npm run play:script -- <file.json>`): a scripted playtest in a muted, isolated browser.
// A script is JSON: {"name", "scene"?, "seed"?, "steps": [...]}. Steps:
//   {"goto": "level", "params": {"n": "2"}}   navigate like a player (waits until the scene is active)
//   {"key": "ArrowUp", "ms": 800}             hold a key (default: one tap)
//   {"press": " "}                            tap a key
//   {"teleport": [3, -1.2], "name": "player"} move a named entity
//   {"wait": 500}                             milliseconds
//   {"snap": "after-turn"}                    a screenshot, NN-<name>.png
//   {"expect": {"path": "world.state.score", "atLeast": 1}}   assert on engine.state() (equals, contains, atLeast, exists)
//   {"waitUntil": {"path": "world.state.phase", "equals": "over"}, "ms": 20000}      poll until it holds (fails on timeout)
//   {"pressUntil": "Enter", "until": {"path": "…", "equals": "…"}, "every": 500, "ms": 60000}   press a key repeatedly
//                                         until the expectation holds (a learner clicking Next until a scene arrives)
// Output: playtest/latest/<name>/ (screenshots, report.json; gitignored). Exit code 1 when an expectation failed.
import {join, resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {freshOut, homeScene, open, OUT, serve, sleep, write} from './lib.mjs';

const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function judge(state, e) {
  const got = at(state, e.path);
  if ('equals' in e) return {ok: JSON.stringify(got) === JSON.stringify(e.equals), got};
  if ('contains' in e) return {ok: Array.isArray(got) && got.includes(e.contains), got};
  if ('atLeast' in e) return {ok: typeof got === 'number' && got >= e.atLeast, got};
  if ('exists' in e) return {ok: (got !== undefined && got !== null) === e.exists, got};
  throw Error(`expect needs equals, contains, atLeast or exists: ${JSON.stringify(e)}`);
}

export async function runScript(script, url) {
  const {launch} = await import('../perf/bench-browser.mjs');
  const dir = freshOut(join(OUT, script.name));
  const report = {name: script.name, steps: [], pass: true};
  const b = await launch({width: 1280, height: 800});
  try {
    await open(b, url, script.scene ?? homeScene(), {seed: script.seed ?? 1});
    let n = 0;
    for (const step of script.steps) {
      const row = {step};
      if (step.goto) await b.evaluate(`window.engine.goto(${JSON.stringify(step.goto)}, ${JSON.stringify(step.params ?? null) ?? 'null'} ?? undefined)`);
      else if (step.key) await b.evaluate(`window.engine.key(${JSON.stringify(step.key)}, ${Number(step.ms ?? 0)})`);
      else if (step.press) await b.evaluate(`window.engine.key(${JSON.stringify(step.press)})`);
      else if (step.teleport) row.ok = await b.evaluate(`window.engine.teleport(${Number(step.teleport[0])}, ${Number(step.teleport[1])}, ${JSON.stringify(step.name ?? 'player')})`);
      else if (step.wait) await sleep(Number(step.wait));
      else if (step.snap) row.file = write(dir, `${String(++n).padStart(2, '0')}-${step.snap}.png`, await b.page.screenshot({type: 'png'}));
      else if (step.expect) { Object.assign(row, judge(await b.evaluate('window.engine.state()'), step.expect)); if (!row.ok) report.pass = false; }
      else if (step.waitUntil || step.pressUntil) {
        const want = step.waitUntil ?? step.until, deadline = Date.now() + Number(step.ms ?? 20000);
        for (;;) {
          Object.assign(row, judge(await b.evaluate('window.engine.state()'), want));
          if (row.ok || Date.now() > deadline) break;
          if (step.pressUntil) await b.evaluate(`window.engine.key(${JSON.stringify(step.pressUntil)})`);
          await sleep(Number(step.every ?? 100));
        }
        row.expect = want;
        if (!row.ok) report.pass = false;
      }
      else throw Error('unknown step ' + JSON.stringify(step));
      if (row.ok === false && step.teleport) report.pass = false;
      report.steps.push(row);
    }
    report.errors = b.errors;
    if (b.errors.length) report.pass = false;
  } finally { await b.close(); }
  write(dir, 'report.json', report);
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('script.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('usage: npm run play:script -- <templates/<name>/playtest/file.json>'); process.exit(64); }
  const script = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const server = await serve();
  try {
    const r = await runScript(script, server.url);
    for (const s of r.steps) { const e = s.step.expect ?? s.expect; if (e || s.file) console.log(`  ${e ? (s.ok ? 'PASS' : 'FAIL') + ' ' + e.path + ' = ' + JSON.stringify(s.got) : 'snap ' + s.file.replace(/^.*playtest/, 'playtest')}`); }
    if (r.errors?.length) console.log('  page errors: ' + r.errors.join(' | '));
    console.log(`play:script ${r.name}: ${r.pass ? 'PASS' : 'FAIL'} (playtest/latest/${r.name}/report.json)`);
    process.exitCode = r.pass ? 0 : 1;
  } finally { await server.close(); }
}
