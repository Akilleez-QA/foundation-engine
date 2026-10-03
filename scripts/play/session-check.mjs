#!/usr/bin/env node
// MP-01 browser check (`npm run test:session-browser`, GAME_DIR=templates/shared-world/game): two isolated Chromium
// contexts open the shared-world template against one local `npm run host` server (started in this process on a
// free loopback port). It checks that both join, that one player's move and paint reach the other through the host,
// that a host restart is ridden out by paced, bounded reconnects on both pages (transient close) and each page then
// shows the restarted host's fresh, empty world before any new action, that a drop of page B alone (its context goes
// offline) leaves page A playing while B resumes its slot and both converge, that a wrong join code is terminal (no
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
    'The client-only drop is Playwright offline emulation of one browser context (Chromium network emulation), not a physical network loss.',
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
  /** Poll a page's world state (or any reader function) until `predicate` holds. */
  const until = async (source, predicate, label, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await (typeof source === 'function' ? Promise.resolve().then(source) : state(source)).catch(() => null);
      if (s && predicate(s)) return s;
      if (Date.now() - t0 > ms) throw Error(`timed out: ${label} (last ${JSON.stringify(s)})`);
      await sleep(50);
    }
  };
  // Joined with a confirmed baseline: the HUD reads "You are pN" rather than "waiting for the world" (stale copy).
  const untilFresh = (page, predicate, label, ms = 30000) => until(() => Promise.all([state(page), hudText(page)]).then(([s, text]) =>
    ({ ...s, live: /You are p\d/.test(text) && !/waiting for the world/.test(text) })),
  s => s.session === 'joined' && s.players === 2 && s.live && predicate(s), label, ms);
  const hudText = page => page.evaluate(() => document.body.innerText);
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

  // 4. The host goes away (close 1001 host-closing, transient) and comes back on the same port: both reconnect, and
  // each page must show the restarted host's new world (fresh baseline), not its last-known copy. Origin of the
  // fresh-baseline assertion: preserved commit 87eb2da (scripts/host.test.mjs), rewritten here for the browser pages.
  const socketsBefore = { ...sockets };
  const oldHost = host.read();
  assert.equal(oldHost.world.board.cells.filter(Boolean).length, 2);
  await host.close();
  await until(pages.a, s => s.session === 'reconnecting', 'a reconnecting');
  await until(pages.b, s => s.session === 'reconnecting', 'b reconnecting');
  // While the host is down each page keeps its last-known world: the stale copy the fresh baseline must replace.
  for (const page of Object.values(pages)) assert.equal((await state(page)).painted, 2, 'last-known world kept while reconnecting');
  await shot('a', 'reconnecting');
  await sleep(300);
  host = await startSessionServer({ rules, port, joinCode, driverMs: 10 });
  // `joined && players === 2` alone can hold on the stale copy (the welcome arrives before the first view), so wait for
  // the HUD to leave "waiting for the world" and for the new world's empty board, with no action sent in between.
  const fresh = await Promise.all(Object.entries(pages).map(([name, page]) => untilFresh(page, s => s.painted === 0, `${name} fresh baseline`)));
  const restarted = host.read();
  assert.equal(restarted.world.board.cells.filter(Boolean).length, 0, 'restarted host board is empty');
  assert.equal(restarted.worldRevision, 2, 'restarted host world revision starts again: two joins on a new world');
  assert.ok(restarted.worldRevision < oldHost.worldRevision, `world revision reset (${oldHost.worldRevision} -> ${restarted.worldRevision})`);
  assert.equal(restarted.metrics.applied, 0, 'no action reached the restarted host before the fresh-baseline check');
  assert.equal(restarted.metrics.joined, 2);
  assert.equal(restarted.metrics.resumed, 0, 'a new host knows no page keys: both pages join as new players');
  assert.notEqual(fresh[0].player, fresh[1].player);
  assert.deepEqual(new Set(fresh.map(s => s.player)), new Set(restarted.players.map(p => p.player)), 'pages show the restarted host roster');
  const attempts = { a: sockets.a - socketsBefore.a, b: sockets.b - socketsBefore.b };
  for (const [name, n] of Object.entries(attempts)) assert.ok(n >= 1 && n <= 7, `${name}: paced, bounded reconnect attempts (${n})`);
  step('host restart', { reconnectSockets: attempts, a: fresh[0], b: fresh[1], oldWorldRevision: oldHost.worldRevision,
    worldRevision: restarted.worldRevision, hostPainted: 0 });
  await pages.a.locator('.scene-view').focus();
  await pages.a.keyboard.press('Space');
  await until(pages.a, s => s.painted === 1, 'a sees its own paint after the restart');
  await until(pages.b, s => s.painted === 1, 'b sees a paint after the restart');
  assert.equal(host.read().world.board.cells.filter(Boolean).length, 1);
  await shot('b', 'rejoined');

  // 4b. Only page B drops (its browser context goes offline) while the host and page A stay up: A keeps playing, B
  // reconnects within its paced bound, resumes the same player slot, and both converge on the host's world.
  const idA = fresh[0].player, idB = fresh[1].player;
  const colorB = host.read().world[idB].color + 1;
  await pages.b.locator('.scene-view').focus();
  await pages.b.keyboard.press('Space');
  await until(pages.a, s => s.painted === 2, 'a sees b\'s paint before the drop');
  const beforeDrop = host.read(), socketsBeforeDrop = { ...sockets };
  await otherContext.setOffline(true);
  await until(pages.b, s => s.session === 'reconnecting', 'b reconnecting after its own drop');
  await until(() => host.read(), h => h.players.find(p => p.player === idB)?.connected === false, 'host sees b away');
  // A keeps playing while B is away: a step and a paint reach the host and A.
  const startA = host.read().world[idA];
  const rightA = startA.x < 3;
  await hold(pages.a, rightA ? 'ArrowRight' : 'ArrowLeft', 200);
  await until(() => host.read(), h => h.world[idA].x !== startA.x, 'a moves while b is away');
  await pages.a.keyboard.press('Space');
  const duringDrop = await until(pages.a, s => s.painted === 3, 'a paints while b is away');
  assert.equal(duringDrop.session, 'joined', 'a stays joined while b is away');
  assert.equal((await state(pages.b)).painted, 2, 'b keeps its last-known world while offline');
  await otherContext.setOffline(false);
  const resumedB = await untilFresh(pages.b, s => s.painted === 3, 'b resumes and converges');
  const afterDrop = host.read();
  assert.equal(resumedB.player, idB, 'b resumes the same player slot');
  assert.equal(afterDrop.metrics.resumed, beforeDrop.metrics.resumed + 1, 'the host resumed b');
  assert.equal(afterDrop.metrics.joined, beforeDrop.metrics.joined, 'no new player joined');
  assert.equal(afterDrop.metrics.left, beforeDrop.metrics.left, 'b never left its slot');
  assert.deepEqual(afterDrop.players.map(p => p.connected), [true, true]);
  const cells = afterDrop.world.board.cells;
  assert.equal(cells.filter(Boolean).length, 3);
  assert.equal(cells.filter(c => c === colorB).length, 1, 'b\'s one paint is applied once (never resent)');
  const finalA = await state(pages.a);
  assert.equal(finalA.session, 'joined'); assert.equal(finalA.player, idA); assert.equal(finalA.painted, 3);
  assert.equal(sockets.a, socketsBeforeDrop.a, 'a never reconnected');
  const dropAttempts = sockets.b - socketsBeforeDrop.b;
  assert.ok(dropAttempts >= 1 && dropAttempts <= 7, `b: paced, bounded reconnect attempts after its drop (${dropAttempts})`);
  step('client drop', { b: resumedB, a: finalA, reconnectSockets: { a: 0, b: dropAttempts },
    resumed: afterDrop.metrics.resumed, applied: afterDrop.metrics.applied - beforeDrop.metrics.applied });
  await shot('a', 'client-drop'); await shot('b', 'client-drop');

  // 5. A wrong join code is a terminal refusal: closed, and no further attempts.
  thirdContext = await b.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC' });
  pages.c = await thirdContext.newPage();
  watch('c', pages.c);
  await pages.c.goto(link('wrong-join-code-0000000000'), { waitUntil: 'load' });
  const refused = await until(pages.c, s => s.session === 'closed', 'c closed');
  const refusedAttempts = sockets.c;
  await sleep(2500);
  assert.equal(sockets.c, refusedAttempts, 'no reconnect after a terminal refusal');
  assert.equal(refusedAttempts, 1);
  await shot('c', 'refused');
  const text = await pages.c.evaluate(() => document.body.innerText);
  assert.match(text, /Disconnected \(auth-rejected\)/);
  step('wrong join code', { c: refused, attempts: refusedAttempts });

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
