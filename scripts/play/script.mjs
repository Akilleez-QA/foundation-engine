#!/usr/bin/env node
import {describeDiagnostic} from './diagnostic-report.mjs';
// scripts/play/script.mjs (`npm run play:script -- <file.json>`): a scripted playtest in a muted, isolated browser.
// A script is JSON: {"name", "scene"?, "seed"?, "steps": [...]}. The step format (goto, key, press, teleport, wait,
// snap, expect, waitUntil, pressUntil, holdUntil, reload) is in docs/recipes/write-a-playtest-script.md and checked by
// script-schema.mjs before any browser starts: a bad file exits 64 with one line per problem.
// A step after a press sees state one frame late: wait for something the press changes (a caption, a scene) before
// waiting for a gate the press only passes through, or a snap shows the moment before the press took effect.
// Output: playtest/latest/<name>/ (screenshots, report.json; gitignored). Exit code 1 when an expectation failed.
import {join, resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {evidencePath, freshOut, homeScene, open, OUT, serve, sleep, write} from './lib.mjs';
import {assertScript, MATCHERS, stepKind} from './script-schema.mjs';

const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function judge(state, e) {
  const got = at(state, e.path);
  if ('equals' in e) return {ok: JSON.stringify(got) === JSON.stringify(e.equals), got};
  if ('contains' in e) return {ok: Array.isArray(got) && got.includes(e.contains), got};
  if ('atLeast' in e) return {ok: typeof got === 'number' && got >= e.atLeast, got};
  if ('exists' in e) return {ok: (got !== undefined && got !== null) === e.exists, got};
  throw Error(`expect needs one of ${MATCHERS.join(', ')}: ${JSON.stringify(e)}`);
}

/** After a reload: the app is up again and its scene is active (the hash keeps the scene, seed and flags). */
const ACTIVE = `!!window.engine && !!document.querySelector('#app[data-scene-state="active"]')`;

export async function runScript(script, url, runtime = {}) {
  assertScript(script);
  const launch = runtime.launch ?? (await import('../perf/bench-browser.mjs')).launch;
  const dir = runtime.directory ?? freshOut(join(OUT, script.name));
  const report = {name: script.name, steps: [], pass: true, errors: []};
  let current;
  const b = await launch({width: 1280, height: 800});
  try {
    await (runtime.open ?? open)(b, url, script.scene ?? homeScene(), {seed: script.seed ?? 1});
    let n = 0;
    for (const step of script.steps) {
      const row = {step},
        kind = stepKind(step);
      current = row;
      report.steps.push(row);
      if (kind === 'reload') {
        // A page reload: pagehide flushes saves as for a player; the same URL reopens the current scene.
        await b.page.reload({waitUntil: 'load'});
        const deadline = Date.now() + Number(step.ms ?? 20000);
        for (;;) {
          if (await b.evaluate(ACTIVE).catch(() => false)) {
            row.ok = true;
            break;
          }
          if (Date.now() > deadline) {
            row.ok = false;
            row.got = 'no active scene after reload';
            break;
          }
          await sleep(100);
        }
        if (!row.ok) report.pass = false;
        else row.scene = await b.evaluate(`document.querySelector('#app')?.getAttribute('data-scene')`);
      } else if (kind === 'goto')
        await b.evaluate(
          `window.engine.goto(${JSON.stringify(step.goto)}, ${JSON.stringify(step.params ?? null) ?? 'null'} ?? undefined)`,
        );
      else if (kind === 'key')
        await b.evaluate(`window.engine.key(${JSON.stringify(step.key)}, ${Number(step.ms ?? 0)})`);
      else if (kind === 'press') await b.evaluate(`window.engine.key(${JSON.stringify(step.press)})`);
      else if (kind === 'teleport')
        row.ok = await b.evaluate(
          `window.engine.teleport(${Number(step.teleport[0])}, ${Number(step.teleport[1])}, ${JSON.stringify(step.name ?? 'player')})`,
        );
      else if (kind === 'wait') await sleep(Number(step.wait));
      else if (kind === 'snap')
        row.file = evidencePath(
          write(dir, `${String(++n).padStart(2, '0')}-${step.snap}.png`, await b.page.screenshot({type: 'png'})),
        );
      else if (kind === 'expect') {
        Object.assign(row, judge(await b.evaluate('window.engine.state()'), step.expect));
        if (!row.ok) report.pass = false;
      } else if (kind === 'waitUntil' || kind === 'pressUntil' || kind === 'holdUntil') {
        const want = step.waitUntil ?? step.until,
          deadline = Date.now() + Number(step.ms ?? 20000);
        if (step.holdUntil) await b.key(step.holdUntil, true);
        try {
          for (;;) {
            Object.assign(row, judge(await b.evaluate('window.engine.state()'), want));
            if (row.ok || Date.now() > deadline) break;
            if (step.pressUntil) await b.evaluate(`window.engine.key(${JSON.stringify(step.pressUntil)})`);
            await sleep(Number(step.every ?? 100));
          }
        } finally {
          if (step.holdUntil)
            try {
              await b.key(step.holdUntil, false);
            } catch (error) {
              report.pass = false;
              report.errors.push('key release: ' + describeDiagnostic(error));
            }
        }
        row.expect = want;
        if (!row.ok) report.pass = false;
      } else throw Error('unknown step ' + JSON.stringify(step));
      if (row.ok === false && step.teleport) report.pass = false;
      if (report.errors.length) {
        report.terminal = true;
        break;
      }
    }
  } catch (error) {
    report.pass = false;
    report.terminal = true;
    report.errors.push(describeDiagnostic(error));
    if (current) {
      current.ok = false;
      current.error = describeDiagnostic(error);
    }
  } finally {
    try {
      await b.close();
    } catch (error) {
      report.pass = false;
      report.terminal = true;
      report.errors.push('browser close: ' + describeDiagnostic(error));
    }
  }
  report.errors.push(...b.errors);
  if (report.errors.length) report.pass = false;
  write(dir, 'report.json', report);
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('script.mjs')) {
  const file = process.argv[2];
  if (!file) {
    console.error(
      'usage: npm run play:script -- <game/playtest/file.json> or templates/<name>/game/playtest/file.json',
    );
    process.exit(64);
  }
  let script;
  try {
    script = JSON.parse(readFileSync(resolve(file), 'utf8'));
    assertScript(script, file);
  } catch (error) {
    console.error(
      error instanceof SyntaxError
        ? `${file}: not valid JSON: ${error.message}`
        : error.code === 'ENOENT'
          ? `${file}: no such file`
          : error.message,
    );
    process.exit(64);
  }
  const server = await serve();
  try {
    const r = await runScript(script, server.url);
    for (const s of r.steps) {
      const e = s.step.expect ?? s.expect;
      if (s.step.reload) console.log(`  ${s.ok ? 'PASS' : 'FAIL'} reload${s.ok ? ' -> ' + s.scene : ': ' + s.got}`);
      else if (e || s.file)
        console.log(
          `  ${e ? (s.ok ? 'PASS' : 'FAIL') + ' ' + e.path + ' = ' + JSON.stringify(s.got) : 'snap ' + s.file}`,
        );
    }
    if (r.errors?.length) console.log('  page errors: ' + r.errors.join(' | '));
    console.log(`play:script ${r.name}: ${r.pass ? 'PASS' : 'FAIL'} (playtest/latest/${r.name}/report.json)`);
    process.exitCode = r.pass ? 0 : 1;
  } catch (error) {
    if (!(await import('../perf/bench-browser.mjs')).reportBrowserError(error)) throw error;
  } finally {
    await server.close();
  }
}
