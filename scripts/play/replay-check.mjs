#!/usr/bin/env node
// SIM-01 browser regression (GAME_DIR=templates/arcade/game): the stock arcade scene opened with ?seed= records its
// fixed-tick input through the dev-only engine.replay surface, replays exactly under a different frame grouping, the
// same log replays exactly in a separate headless harness (testScene), a state change outside the log is detected at
// the tick it happens, and a corrupted log is refused without re-entering the scene. Run with `node --import tsx`.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {serve, open, ROOT} from './lib.mjs';
import {gameDirLabel} from '../lib/game-dir.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
import {replaySceneLog} from '../../src/kits/replay/index.ts';

const out = resolve(process.argv[2] ?? 'playtest/replay'); mkdirSync(out, {recursive: true});
const git = args => execFileSync('git', args, {cwd: ROOT, encoding: 'utf8'}).trim();
const report = {revision: git(['rev-parse', 'HEAD']), dirtyWorktree: git(['status', '--porcelain']).length > 0, game: gameDirLabel(), seed: 7, states: [],
  limitations: ['Desktop Chromium (software GL) with the test API; one template scene', 'Same browser and build for record and replay: no cross-device or cross-browser floating-point claim',
    'Frame-phase systems, ctx.time and world events are outside the tick log', 'No physical-device, production-build or multiplayer acceptance']};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
assert.equal(gameDirLabel(), 'templates/arcade/game', 'run with GAME_DIR=templates/arcade/game');
const engine = (b, fn, arg) => b.page.evaluate(fn, arg);
const stepUntil = async (b, ms, done, limit = 2000) => {
  for (let i = 0; i < limit; i++) { if (await done()) return; await engine(b, m => window.engine.clock.step(m), ms); }
  throw Error('replay did not finish');
};
let server, b;
try {
  server = await serve(); b = await launch({width: 1280, height: 800, strictClose: true});
  await open(b, server.url, 'play', {seed: 7});
  assert.deepEqual(await engine(b, () => window.engine.replay.read().status), 'idle', 'nothing is armed until asked');

  // Record: arrive, then hold the one frame loop and drive it in 50 ms steps with real key events.
  const started = await engine(b, () => window.engine.replay.start({mode: 'record', every: 1, maxTicks: 1800}));
  assert.equal(started.status, 'started', JSON.stringify(started));
  await engine(b, () => window.engine.clock.hold());
  await b.page.locator('.scene-view').focus();
  for (const [key, ms] of [['ArrowLeft', 400], [null, 300], ['ArrowRight', 650], [null, 450]]) {
    if (key) await b.page.keyboard.down(key);
    await engine(b, m => window.engine.clock.step(m), ms);
    if (key) await b.page.keyboard.up(key);
  }
  const recorded = await engine(b, () => window.engine.replay.read());
  assert.equal(recorded.status, 'recording', JSON.stringify({status: recorded.status, reason: recorded.reason}));
  assert.ok(recorded.ticks >= 100, `recorded ${recorded.ticks} ticks`);
  assert.match(recorded.log, /\\"steer\\":-1/, 'left steering was recorded');
  assert.match(recorded.log, /\\"steer\\":1/, 'right steering was recorded');
  await engine(b, () => window.engine.replay.stop());
  writeFileSync(resolve(out, 'arcade-seed-7.replay.json'), recorded.log + '\n');
  report.states.push({step: 'record', ticks: recorded.ticks, logBytes: Buffer.byteLength(recorded.log), digests: recorded.digests.entries.length});

  // Replay in the browser: real-time frames after arrival, then 17 ms steps (a different grouping than recording).
  await engine(b, () => window.engine.clock.resume());
  const replaying = await engine(b, log => window.engine.replay.start({mode: 'replay', log}), recorded.log);
  assert.equal(replaying.status, 'started', JSON.stringify(replaying));
  await engine(b, () => window.engine.clock.hold());
  await stepUntil(b, 17, () => engine(b, () => window.engine.replay.read().status !== 'replaying'));
  const replayed = await engine(b, () => window.engine.replay.read());
  assert.equal(replayed.status, 'complete');
  assert.deepEqual(replayed.comparison, {status: 'equal', from: 0, through: recorded.ticks - 1, samples: recorded.ticks});
  report.states.push({step: 'browser replay', comparison: replayed.comparison});

  // The same log in a separate headless harness: testScene with the log's seed, one logged input per tick.
  const [{default: game}, {default: play}, {default: steer}, {default: restart}] = await Promise.all(
    ['game', 'play', 'steer', 'restart'].map(m => import(`../../templates/arcade/game/${m}.ts`)));
  const headless = await replaySceneLog(play, {game, inputs: [steer, restart], log: recorded.log,
    limits: {maxTicks: 1800, maxBytes: 256 << 10, input: {maxBytes: 4096, maxNodes: 256, maxDepth: 4}, log: {maxBytes: 8 << 20, maxNodes: 1 << 20, maxDepth: 8}},
    trace: {every: 1, maxEntries: 1800, maxDigestLength: 16}});
  assert.equal(headless.status, 'replayed', JSON.stringify(headless));
  assert.deepEqual(headless.comparison, {status: 'equal', from: 0, through: recorded.ticks - 1, samples: recorded.ticks});
  report.states.push({step: 'headless replay of the browser log', comparison: headless.comparison});

  // A change the log cannot explain (a test-API teleport between frames) is reported at the next tick.
  await engine(b, () => window.engine.clock.resume());
  assert.equal((await engine(b, log => window.engine.replay.start({mode: 'replay', log}), recorded.log)).status, 'started');
  await engine(b, () => window.engine.clock.hold());
  await stepUntil(b, 17, () => engine(b, () => window.engine.replay.read().ticks >= 60));
  const at = await engine(b, () => window.engine.replay.read().ticks);
  assert.ok(at < recorded.ticks - 10);
  assert.equal(await engine(b, () => window.engine.teleport(3.21, 5, 'player')), true);
  await stepUntil(b, 17, () => engine(b, () => window.engine.replay.read().status !== 'replaying'));
  const diverged = (await engine(b, () => window.engine.replay.read())).comparison;
  assert.equal(diverged.status, 'diverged');
  assert.deepEqual([diverged.tick, diverged.after, diverged.exact], [at, at - 1, true]);
  report.states.push({step: 'injected state change', teleportBeforeTick: at, comparison: {status: diverged.status, tick: diverged.tick, after: diverged.after, exact: diverged.exact}});

  // A corrupted log is refused before re-entry; the visit is unchanged.
  await engine(b, () => window.engine.clock.resume());
  const epoch = await engine(b, () => window.engine.probe('scene').epoch);
  const corrupted = recorded.log.replace('"seed":7', '"seed":8');
  assert.deepEqual(await engine(b, log => window.engine.replay.start({mode: 'replay', log}), corrupted), {status: 'refused', reason: 'corrupt-checksum'});
  assert.equal(await engine(b, () => window.engine.probe('scene').epoch), epoch, 'a refused log does not re-enter the scene');
  report.states.push({step: 'corrupted log', refused: 'corrupt-checksum'});

  // A log recorded under another seed is refused at the visit (the page is ?seed=7), and start says so.
  await engine(b, () => window.engine.replay.start({mode: 'record'}));
  const otherSeed = (await engine(b, () => window.engine.replay.read())).log;
  await engine(b, () => window.engine.replay.stop());
  const header = JSON.parse(otherSeed).header;
  assert.equal(header.seed, 7);
  const {encodeReplay} = await import('../../src/kits/replay/index.ts');
  const parsed = JSON.parse(otherSeed);
  const reseeded = encodeReplay({header: {...header, seed: 8}, ticks: parsed.ticks, truncatedAt: parsed.truncatedAt, runs: parsed.runs, digests: parsed.digests});
  assert.deepEqual(await engine(b, log => window.engine.replay.start({mode: 'replay', log}), reseeded), {status: 'refused', reason: 'incompatible-seed'});
  report.states.push({step: 'log for another seed', refused: 'incompatible-seed'});

  await b.page.screenshot({path: resolve(out, 'after-replay.png')});
  assert.deepEqual(b.errors, []);
  report.passed = true;
} catch (error) { evidence.fail(error); } finally {
  await evidence.close(b, 'browser cleanup'); await evidence.close(server, 'server cleanup'); evidence.finish();
}
console.log(`Replay: PASS; ${out}`);
