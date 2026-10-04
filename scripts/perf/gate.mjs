// scripts/perf/gate.mjs (`npm run gate`): the integration gate (STANDARD chapter 12, AGENTS.md). It exits non-zero on
// any failure or blocking regression. Run it on the rebased head before an integration merge and paste its summary.
//
//   1. generators, then tsc --noEmit           5. bundle check on that build (first-load JS, large chunks)
//   2. lint: layers, architecture ratchet,      6. software-GL bench of every scene in perf/budgets.ts, with the
//      CSS ratchet, budget ratchet                 ADR 0046 evidence cache
//   3. npm test, play:snap (smoke), then the   7. budgets and baselines; failing evidence (fresh or reused) is
//      game's browser playtests                    confirmed by a fresh run: a count fails only if two consecutive
//      (play:playtests)                            runs breach it. A non-comparable window (ADR 0053) never blocks;
//   4. build this tree into a temp folder          if it stays so, the gate fails as INCONCLUSIVE
//
// Only counts block in software GL (draws, triangles, casters, texture/canvas MiB, heap, contexts, load MiB); frame
// and load times are advisory there. The bench is muted and isolated (bench-browser.mjs); it never touches audio.
//
// Usage: npm run gate [-- --fresh] [--cache-only] [--bench-only] [--synthetic <sample>.<field>+<n>]
//   --fresh        ignore the cache and bench every scene
//   --cache-only   never start a bench: a cache miss fails
//   --bench-only   skip steps 1 to 3
//   --synthetic    add n to one field of the evidence before checking, e.g. main.drawsPerRenderedFrame+100; the result
//                  is never cached (proof that a regression blocks)
import '../lib/node-version.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildAndServe} from './build.mjs';
import {defaultRunPath, experimentDescriptor, parseArgs, runBench, writeRun} from './bench.mjs';
import {cacheKey, loadRun, storeRun} from './cache.ts';
import {checkBundle} from './bundle-check.ts';
import {reportRun} from './budget-check.ts';
import {decide} from './gate-verdict.ts';
import {npmCommand, toolCommand} from '../lib/tool.mjs';
import {ACTIVE_SCENES, SCENE_IDS} from '../../perf/budgets.ts';

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const synthetic = (() => {
  const i = argv.indexOf('--synthetic');
  if (i < 0) return null;
  const m = /^([\w:.-]+?)\.(\w+)([+-]\d+(?:\.\d+)?)$/.exec(argv[i + 1] ?? '');
  if (!m) throw Error('--synthetic <sample>.<field>+<n>');
  return {sample: m[1], field: m[2], delta: +m[3]};
})();
const root = fileURLToPath(new URL('../..', import.meta.url));
const t0 = Date.now();
const fail = [];
const say = s => console.log(s);

// cmd is `node` (this Node) or a command from scripts/lib/tool.mjs (no npx and no bare npm: the same on Windows).
function step(name, cmd, args = []) {
  const c = typeof cmd === 'string' ? {command: cmd === 'node' ? process.execPath : cmd, args, shell: false} : cmd;
  const t = Date.now();
  const r = spawnSync(c.command, c.args, {cwd: root, stdio: 'inherit', shell: c.shell});
  const ok = r.status === 0;
  say(`gate: ${name} ${ok ? 'ok' : 'FAILED'} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  if (!ok) fail.push(name);
  return ok;
}

/** The browser's version and backend string (part of the descriptor) without running the bench. */
async function environment(o) {
  const {launch} = await import('./bench-browser.mjs');
  const b = await launch({...o.view, gpu: o.gpu});
  try {
    await b.page.goto('about:blank');
    return {
      launchArguments: b.launchArguments,
      browser: 'Chromium ' + b.version,
      gpuString: await b.evaluate(
        `(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');const e=g&&g.getExtension('WEBGL_debug_renderer_info');const r=g?g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER):'none';g?.getExtension('WEBGL_lose_context')?.loseContext();return r})()`,
      ),
    };
  } finally {
    await b.close();
  }
}

function applySynthetic(run) {
  if (!synthetic) return run;
  const s = run.samples.find(x => x.id === synthetic.sample);
  if (!s || typeof s[synthetic.field] !== 'number')
    throw Error(`--synthetic: no numeric ${synthetic.field} in ${synthetic.sample}`);
  say(
    `gate: SYNTHETIC ${synthetic.sample}.${synthetic.field} ${s[synthetic.field]} -> ${s[synthetic.field] + synthetic.delta} (evidence not cached)`,
  );
  return {
    ...run,
    samples: run.samples.map(x => (x === s ? {...x, [synthetic.field]: x[synthetic.field] + synthetic.delta} : x)),
  };
}

if (!flag('--bench-only')) {
  if (step('generate', 'node', ['scripts/generate.mjs'])) step('tsc', toolCommand('tsc', ['--noEmit']));
  step('lint', npmCommand(['run', '--silent', 'lint']));
  step('npm test', npmCommand(['test', '--silent']));
  // Smoke: the first scene opens in a muted browser on the dev server with no page errors (scripts/play/snap.mjs).
  step('play:snap', 'node', ['scripts/play/snap.mjs']);
  // Every scripted browser playtest of the game (<game>/playtest/*.json and each `how: 'playtest'` criterion): a
  // failing playtest fails the gate (scripts/play/playtests.ts).
  step('play:playtests', toolCommand('tsx', ['scripts/play/playtests.ts']));
}
const o = {...parseArgs([]), check: false};
const experiment = {route: [...SCENE_IDS], active: [...ACTIVE_SCENES]};
let served = null;
try {
  if (!SCENE_IDS.length) throw Error('game/budgets.json lists no scenes; the bench has nothing to measure');
  served = await buildAndServe();
  const bundle = checkBundle(served.outDir);
  say(bundle.text);
  if (!bundle.ok) fail.push('bundle');
  const env = await environment(o);
  const descriptor = createHash('sha256')
    .update(JSON.stringify(experimentDescriptor(o, env)))
    .digest('hex');
  const key = cacheKey({buildDigest: served.digest, descriptor});
  say(
    `gate: build ${served.digest.slice(0, 12)} (${served.fileCount} files) · experiment ${descriptor.slice(0, 12)} · cache key ${key.slice(0, 12)}`,
  );
  let run = null,
    reused = false,
    runs = 0;
  if (!flag('--fresh')) {
    const hit = loadRun(key, experiment);
    if (hit.ok) {
      run = hit.run;
      reused = true;
      say(`gate: REUSED complete evidence from ${run.when}; re-checking it against today's budgets and baselines`);
    } else say(`gate: cache miss: ${hit.reason}`);
  }
  const fresh = async () => {
    if (flag('--cache-only')) throw Error('--cache-only: no complete evidence for this build and experiment');
    const r = await runBench({...o, base: served.url}, {log: s => say('  ' + s)});
    r.build = {digest: served.digest, files: served.fileCount};
    r.chunks = served.chunks;
    say('gate: PerfRun → ' + writeRun(r, defaultRunPath(r).replace(/\.json$/, `-gate-${++runs}.json`)));
    if (r.descriptor !== descriptor) {
      say('gate: the bench measured another experiment than the key describes; not caching');
      return r;
    }
    if (!synthetic) {
      const refused = storeRun(r, key, experiment);
      say(
        refused.length
          ? `gate: not cached (incomplete): ${refused.slice(0, 4).join('; ')}`
          : `gate: evidence cached under ${key.slice(0, 12)}`,
      );
    }
    return r;
  };
  if (!run) {
    say('gate: benching every scene (software GL)');
    run = await fresh();
  }
  const result = reportRun(applySynthetic(run));
  say(result.text);
  let decision = decide(result.report);
  if (!result.report.ok && !synthetic && !flag('--cache-only')) {
    say(
      `gate: confirming with a fresh run (two consecutive breaches block)${reused ? '; the reused evidence counts as the first run' : ''}`,
    );
    const second = reportRun(await fresh());
    say(second.text);
    decision = decide(result.report, second.report);
  }
  if (decision.confirmed.length)
    say(
      `gate: ${decision.confirmed.length} failing check(s) confirmed on comparable windows: ${decision.confirmed.join(', ')}`,
    );
  if (decision.inconclusive.length)
    say(`gate: INCONCLUSIVE (not comparable after re-sampling; not a regression): ${decision.inconclusive.join(', ')}`);
  if (decision.verdict === 'fail') fail.push('perf budgets');
  else if (decision.verdict === 'inconclusive') fail.push('perf inconclusive');
} catch (e) {
  say('gate: bench FAILED: ' + e.message);
  fail.push('bench');
} finally {
  await served?.close();
}
// Every budget raise on this branch carries a reviewed Perf-Budget trailer (checked by lint:budgets); list them.
const base =
  spawnSync('git', ['rev-parse', '--verify', 'origin/main'], {cwd: root, encoding: 'utf8'}).status === 0
    ? 'origin/main'
    : null;
const trailers = base
  ? (spawnSync('git', ['log', '--format=%(trailers:key=Perf-Budget,valueonly)', `${base}..HEAD`], {
      cwd: root,
      encoding: 'utf8',
    })
      .stdout?.split('\n')
      .map(l => l.trim())
      .filter(Boolean) ?? [])
  : [];
if (trailers.length) {
  say(`gate: ${trailers.length} Perf-Budget trailer(s) on this branch (${base}..HEAD):`);
  for (const t of trailers) say('  Perf-Budget: ' + t);
}
say(`gate: ${fail.length ? 'FAIL (' + fail.join(', ') + ')' : 'PASS'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exitCode = fail.length ? 1 : 0;
