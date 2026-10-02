#!/usr/bin/env node
// MP-01 browser check (`npm run test:session-browser`, GAME_DIR=templates/shared-world/game): two isolated Chromium
// contexts open the shared-world template against one local `npm run host` server (started in this process on a
// free loopback port). It checks that both join, that one player's move and paint reach the other through the host,
// that a host restart is ridden out by paced reconnects (transient close), that a wrong join code is terminal (no
// further attempts), and that integrity runs in observe mode. Evidence: <out>/report.json and screenshots.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, ROOT } from './lib.mjs';
import { gameDirLabel } from '../lib/game-dir.mjs';
import { launch } from '../perf/bench-browser.mjs';
import { diagnosticReport } from './diagnostic-report.mjs';
import { loadSessionRules, startSessionServer } from '../host.mjs';

const out = resolve(process.argv[2] ?? 'playtest/session');
mkdirSync(out, { recursive: true });
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const report = {
  revision: git(['rev-parse', 'HEAD']), dirtyWorktree: git(['status', '--porcelain']).length > 0, game: gameDirLabel(),
  passed: false, steps: [], screenshots: [], pageErrors: [], consoleErrors: [], expectedConsoleErrors: [], host: null,
  limitations: [
    'Two isolated desktop Chromium contexts (headless, software GL) on one machine against a loopback host; no LAN, WAN, TLS, physical-device or scalability evidence.',
    'The host restart is the same process closing and re-listening on the same port with the same join code; its world is new (in-memory state).',
    'Keyboard input through Playwright; no gamepad, touch or simultaneous-input evidence.',
    'Integrity runs in observe mode; this check does not attempt cheating.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
assert.equal(gameDirLabel(), 'templates/shared-world/game', 'run with GAME_DIR=templates/shared-world/game');
const rules = await loadSessionRules(join(ROOT, 'templates/shared-world/game'));
let host, server, b, otherContext, thirdContext;
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  host = await startSessionServer({ rules, port: 0, driverMs: 10 });
  const { port, joinCode } = host;
  server = await serve();
  b = await launch({ width: 1280, height: 800, strictClose: true });
  otherContext = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC' });
  const pages = { a: b.page, b: await otherContext.newPage() };
  const sockets = { a: 0, b: 0, c: 0 };
  const watch = (name, page) => {
    page.on('pageerror', e => report.pageErrors.push(`${name}: ${e.message}`));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      // A refused connection while the host restarts is logged by Chromium itself; it is the expected transient loss.
      (/WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/session' failed/.test(m.text()) ? report.expectedConsoleErrors : report.consoleErrors)
        .push(`${name}: ${m.text().replace(joinCode, '[join]')}`);
    });
    // Count session sockets only (the dev server's own HMR socket is not ours).
    page.on('websocket', socket => { if (/\/session$/.test(socket.url())) sockets[name]++; });
  };
  watch('a', pages.a); watch('b', pages.b);
  const link = (code = joinCode) => `${server.url}/?host=${port}&join=${code}&flags=dev.silent&seed=1#scene/world`;
  const state = page => page.evaluate(() => window.engine.state().world.state);
  const until = async (page, predicate, label, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await state(page).catch(() => null);
      if (s && predicate(s)) return s;
      if (Date.now() - t0 > ms) throw Error(`timed out: ${label} (last ${JSON.stringify(s)})`);
      await sleep(50);
    }
  };
  const step = (label, data) => report.steps.push({ label, ...data });
  const shot = async (name, label) => {
    const path = resolve(out, `${label}-${name}.png`);
    await pages[name].screenshot({ path });
    report.screenshots.push(path);
  };
  const hold = async (page, key, ms) => {
    await page.locator('.scene-view').focus();
    await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key);
  };

  // 1. Both tabs join one host and see two players.
  await Promise.all(Object.values(pages).map(page => page.goto(link(), { waitUntil: 'load' })));
  const joinedA = await until(pages.a, s => s.session === 'joined' && s.players === 2, 'a joined with two players');
  const joinedB = await until(pages.b, s => s.session === 'joined' && s.players === 2, 'b joined with two players');
  assert.notEqual(joinedA.player, joinedB.player);
  step('joined', { a: joinedA, b: joinedB, host: host.read().players });
  await shot('a', 'joined'); await shot('b', 'joined');

  // 2. A moves and paints; B sees it through the host.
  const before = host.read().world[joinedA.player];
  const right = before.x < 3;
  await hold(pages.a, right ? 'ArrowRight' : 'ArrowLeft', 300);
  await pages.a.keyboard.press('Space');
  await until(pages.b, s => s.painted === 1, 'b sees a\'s paint');
  const moved = host.read().world[joinedA.player];
  assert.ok(right ? moved.x > before.x : moved.x < before.x, `host moved ${joinedA.player} from ${before.x} to ${moved.x}`);
  // 3. B paints too; A sees two painted cells.
  await pages.b.locator('.scene-view').focus();
  await pages.b.keyboard.press('Space');
  await until(pages.a, s => s.painted === 2, 'a sees b\'s paint');
  const afterPaint = host.read();
  assert.equal(afterPaint.world.board.cells.filter(Boolean).length, 2);
  step('moved and painted', { before, moved, a: await state(pages.a), b: await state(pages.b), applied: afterPaint.metrics.applied });
  await sleep(300);
  await shot('a', 'painted'); await shot('b', 'painted');

  // 4. The host goes away (close 1001 host-closing, transient) and comes back on the same port: both reconnect.
  const socketsBefore = { ...sockets };
  await host.close();
  await until(pages.a, s => s.session === 'reconnecting', 'a reconnecting');
  await until(pages.b, s => s.session === 'reconnecting', 'b reconnecting');
  await shot('a', 'reconnecting');
  await sleep(300);
  host = await startSessionServer({ rules, port, joinCode, driverMs: 10 });
  const back = await Promise.all(Object.values(pages).map((page, i) => until(page, s => s.session === 'joined' && s.players === 2, `${i} rejoined`, 30000)));
  step('host restart', { reconnectSockets: { a: sockets.a - socketsBefore.a, b: sockets.b - socketsBefore.b }, a: back[0], b: back[1],
    note: 'a restarted host starts a new in-memory world, so painted cells reset' });
  assert.ok(sockets.a - socketsBefore.a >= 1 && sockets.a - socketsBefore.a <= 7, 'paced, bounded reconnect attempts');
  await pages.a.locator('.scene-view').focus();
  await pages.a.keyboard.press('Space');
  await until(pages.b, s => s.painted === 1, 'b sees a paint after the restart');
  await shot('b', 'rejoined');

  // 5. A wrong join code is a terminal refusal: closed, and no further attempts.
  thirdContext = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC' });
  pages.c = await thirdContext.newPage();
  watch('c', pages.c);
  await pages.c.goto(link('wrong-join-code-0000000000'), { waitUntil: 'load' });
  const refused = await until(pages.c, s => s.session === 'closed', 'c closed');
  const attempts = sockets.c;
  await sleep(2500);
  assert.equal(sockets.c, attempts, 'no reconnect after a terminal refusal');
  assert.equal(attempts, 1);
  await shot('c', 'refused');
  const text = await pages.c.evaluate(() => document.body.innerText);
  assert.match(text, /Disconnected \(auth-rejected\)/);
  step('wrong join code', { c: refused, attempts });

  // 6. Integrity ran in observe mode and changed nothing.
  const final = host.read();
  assert.equal(final.integrity.mode, 'observe');
  assert.equal(final.integrity.stats.rejected, 0);
  assert.equal(final.integrity.stats.closed, 0);
  report.host = { players: final.players, metrics: final.metrics, closeReasons: final.closeReasons, integrity: final.integrity.stats };
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  for (const [owner, label] of [[thirdContext, 'third context'], [otherContext, 'second context']]) {
    try { await owner?.close(); } catch (error) { evidence.fail(error, label); }
  }
  await evidence.close(b, 'browser');
  await evidence.close(server, 'dev server');
  await evidence.close(host, 'session host');
  evidence.finish();
  console.log(`session-check: ${report.passed ? 'PASS' : 'FAIL'} (${report.steps.length} steps; report ${resolve(out, 'report.json')})`);
}
