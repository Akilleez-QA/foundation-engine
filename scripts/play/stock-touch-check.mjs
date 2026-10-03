#!/usr/bin/env node
// Stock consumer sizing, emulated-touch routes and lesson content/control separation; not physical-device acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/stock-touch');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  cases: [],
  limitations: [
    'Chromium touch emulation, not physical phone/tablet/controller acceptance.',
    'Only primary controls in these authored routes; no complete accessibility, essential-world visibility or sustained-hardware certification.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const profiles = [
  {id: 'compact', width: 320, height: 568},
  {id: 'phone-portrait', width: 390, height: 844},
  {id: 'phone-landscape', width: 844, height: 390},
  {id: 'tablet', width: 820, height: 1180},
];
const routes = [
  {
    template: 'mechanics',
    scene: 'lab',
    selector: '.scene-overlay section button',
    action: 'Ride the platform',
    after: 'Step off safely',
  },
  {
    template: 'expedition',
    scene: 'field',
    selector: '.scene-overlay section button',
    action: 'Begin survey',
    after: 'Stop',
  },
  {
    template: 'expedition',
    scene: 'shelter',
    selector: '.scene-overlay section button',
    action: null,
    after: 'Begin survey',
  },
  {
    template: 'learn',
    scene: 'day-night',
    selector: '.scene-overlay nav button',
    action: null,
    pause: true,
    traverse: true,
    // Lesson content that the wrapped control bar and the progress line must never cover.
    clear: [
      ['.scene-overlay nav', '.chalkboard'],
      ['.scene-overlay nav', '.explorer-slider'],
      ['.scene-overlay nav', '.explorer-quiz'],
      ['.scene-overlay > p', '.explorer-quiz'],
    ],
  },
];
let server, browser;
try {
  for (const route of routes) {
    process.env.GAME_DIR = `templates/${route.template}/game`;
    execFileSync(process.execPath, ['scripts/generate.mjs'], {cwd: ROOT, env: process.env, stdio: 'pipe'});
    server = await createServer({root: ROOT, logLevel: 'error', server: {host: '127.0.0.1', port: 0}});
    await server.listen();
    for (const profile of profiles) {
      browser = await launch({...profile, mobile: true, strictClose: true});
      const page = browser.page;
      // bench-browser collects pageerror/console errors; window 'error' events (e.g. ResizeObserver loop reports) are
      // dispatched without either, so record them in the page and fail on them too.
      await page.addInitScript(() => {
        window.__windowErrors = [];
        addEventListener('error', e => window.__windowErrors.push(String(e.message ?? e)), true);
      });
      const windowErrors = () => page.evaluate(() => window.__windowErrors ?? []);
      await page.goto(`${server.resolvedUrls.local[0]}?flags=dev.silent#scene/${route.scene}`);
      await page.locator(route.selector).first().waitFor();
      const controls = await page.locator(route.selector).evaluateAll(buttons =>
        buttons
          .filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
          .map(b => {
            const r = b.getBoundingClientRect(),
              style = getComputedStyle(b),
              hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return {
              label: b.textContent,
              font: parseFloat(style.fontSize),
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              right: r.right,
              bottom: r.bottom,
              hit: hit === b || b.contains(hit),
              disabled: b.disabled,
            };
          }),
      );
      const row = {template: route.template, scene: route.scene, profile, controls, errors: [], passed: false};
      report.cases.push(row);
      assert.ok(controls.length, 'visible controls');
      for (const control of controls) {
        assert.ok(
          control.width >= 48 && control.height >= 48,
          `${route.template}/${route.scene}/${profile.id}: target ${control.label} below 48 CSS px`,
        );
        assert.ok(control.font >= 16, `${route.template}/${route.scene}/${profile.id}: primary text below 16 CSS px`);
        assert.ok(
          control.x >= 0 && control.y >= 0 && control.right <= profile.width && control.bottom <= profile.height,
          'target outside viewport',
        );
        assert.ok(control.hit, 'target covered at center');
      }
      const scrolledPanels = [];
      const separation = async () => {
        const result = await page.evaluate(
          pairs =>
            pairs.map(([a, b]) => {
              const rect = s =>
                [...document.querySelectorAll(s)]
                  .filter(e => e.getClientRects().length && getComputedStyle(e).display !== 'none')
                  .map(e => e.getBoundingClientRect());
              const overlaps = [];
              for (const x of rect(a))
                for (const y of rect(b))
                  if (x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom)
                    overlaps.push({[a]: [x.top, x.bottom], [b]: [y.top, y.bottom]});
              return {pair: [a, b], present: rect(a).length > 0 && rect(b).length > 0, overlaps};
            }),
          route.clear,
        );
        for (const s of result)
          assert.deepEqual(
            s.overlaps,
            [],
            `${route.template}/${route.scene}/${profile.id}: ${s.pair.join(' overlaps ')}`,
          );
        // A panel the layout fitted (it scrolls) must be reachable: hit-testable at its centre, focusable, and actually
        // scrolled by the wheel when its content overflows.
        const fitted = await page.evaluate(() => {
          for (const e of document.querySelectorAll('[data-fit-check]')) delete e.dataset.fitCheck;
          return [...document.querySelectorAll('.scene-overlay > section')]
            .filter(e => e.getClientRects().length && e.style.overflowY === 'auto')
            .map((e, i) => {
              e.dataset.fitCheck = String(i);
              const r = e.getBoundingClientRect(),
                hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return {
                i,
                x: r.x + r.width / 2,
                y: r.y + r.height / 2,
                reachable: hit === e || e.contains(hit),
                tab: e.tabIndex,
                overflow: e.scrollHeight - e.clientHeight,
              };
            });
        });
        for (const f of fitted) {
          assert.ok(f.reachable, `${profile.id}: fitted panel covered at its centre`);
          assert.ok(f.tab >= 0, `${profile.id}: fitted panel not focusable`);
          if (f.overflow > 1) {
            const el = page.locator(`[data-fit-check="${f.i}"]`);
            await page.mouse.move(f.x, f.y);
            await page.mouse.wheel(0, 200);
            await page.waitForFunction(i => document.querySelector(`[data-fit-check="${i}"]`).scrollTop > 0, f.i, {
              timeout: 2000,
            });
            f.scrolled = await el.evaluate(e => e.scrollTop);
            await el.evaluate(e => {
              e.scrollTop = 0;
            });
            scrolledPanels.push({profile: profile.id, overflow: f.overflow, scrolled: f.scrolled});
          }
        }
        return result;
      };
      if (route.clear) {
        // Wait until the bar has wrapped and the layout observer has published its reserve.
        await page
          .waitForFunction(
            () =>
              getComputedStyle(document.querySelector('.scene-overlay')).getPropertyValue(
                '--learn-controls-reserve',
              ) !== '',
            null,
            {timeout: 2000},
          )
          .catch(() => {});
        await page.waitForTimeout(100);
        row.separation = await separation();
        assert.ok(
          row.separation.some(s => s.present),
          'no lesson content measured against the bar',
        );
      }
      if (route.pause) {
        const pause = page.locator('[data-command="pause"]'),
          before = await pause.innerText();
        await pause.tap();
        await page.waitForFunction(
          old => document.querySelector('[data-command="pause"]')?.textContent !== old,
          before,
        );
      } else {
        const action = route.action
          ? page.getByRole('button', {name: route.action, exact: true})
          : page.locator(route.selector).first();
        await action.tap();
        await page.getByRole('button', {name: route.after, exact: true}).waitFor();
      }
      row.errors = [...browser.errors, ...(await windowErrors())];
      assert.deepEqual(row.errors, []);
      if (route.pause) {
        row.lifecycle = await page.evaluate(async () => {
          const {createControls} = await import('/src/kits/learn/ui.ts');
          const {createSlider, createQuizPanel} = await import('/src/kits/concept-explorer/ui.ts');
          const host = document.createElement('div');
          document.body.append(host);
          let commands = 0,
            answers = 0,
            changes = 0;
          const controls = createControls(host);
          controls.onCommand(() => commands++);
          const button = host.querySelector('button');
          button.click();
          const slider = createSlider(host, {id: 'owned', label: 'Owned', min: 0, max: 10, step: 1, value: 0});
          slider.onInput(() => changes++);
          const input = host.querySelector('input');
          input.value = '2';
          input.dispatchEvent(new Event('input'));
          const quiz = createQuizPanel(host, {questionOf: () => 'Question', hintLabel: 'Hint'});
          const view = {
            prompt: 'Choose',
            options: [{id: 'a', text: 'A'}],
            hints: [],
            feedback: null,
            state: 'asking',
            chosen: null,
            index: 0,
            count: 1,
          };
          quiz.onAnswer(() => answers++);
          quiz.set(view);
          const answer = host.querySelector('[data-option]');
          answer.click();
          controls.destroy();
          slider.destroy();
          quiz.destroy();
          controls.destroy();
          slider.destroy();
          quiz.destroy();
          controls.onCommand(() => commands++);
          slider.onInput(() => changes++);
          quiz.onAnswer(() => answers++);
          button.click();
          answer.click();
          input.value = '3';
          input.dispatchEvent(new Event('input'));
          slider.show(true);
          slider.set(7);
          quiz.set(view);
          const result = {commands, answers, changes, remaining: host.children.length, retiredValue: slider.value};
          host.remove();
          return result;
        });
        assert.deepEqual(row.lifecycle, {commands: 1, answers: 1, changes: 1, remaining: 0, retiredValue: 2});
      }
      if (route.traverse) {
        // A long objectives card (six objectives) in a pointer-events:none host, as the scene overlay is: when the layout
        // fits it, the wheel must scroll it and it must take keyboard focus.
        row.longCard = await page.evaluate(async () => {
          const {createControls} = await import('/src/kits/learn/ui.ts');
          const host = document.createElement('div');
          host.style.cssText = 'position:fixed;left:0;right:0;top:47px;bottom:0;pointer-events:none;z-index:10;';
          document.body.append(host);
          const controls = createControls(host),
            labels = Object.fromEntries(
              ['next', 'back', 'again', 'hint', 'question', 'pause', 'play', 'finished', 'controls'].map(k => [k, k]),
            );
          controls.set({
            progress: 'Step 1 of 4',
            objectivesTitle: 'Today you will learn',
            objectives: Array.from({length: 6}, (_, i) => ({
              text: `Objective ${i + 1}: a sentence long enough to wrap onto a second line on a phone`,
              met: false,
            })),
            can: {next: true, back: true, again: true, hint: true, question: true, pause: true},
            paused: false,
            labels,
            finished: false,
          });
          for (let i = 0; i < 3; i++) {
            await new Promise(r => requestAnimationFrame(r));
            controls.layout();
          } // as the lesson frame does
          const card = [...host.querySelectorAll('section')].find(e => e.getClientRects().length);
          card.dataset.longCard = '1';
          const r = card.getBoundingClientRect();
          return {
            fitted: card.style.overflowY === 'auto',
            overflow: card.scrollHeight - card.clientHeight,
            tab: card.tabIndex,
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
          };
        });
        if (row.longCard.overflow > 1) {
          assert.ok(
            row.longCard.fitted && row.longCard.tab >= 0,
            `${profile.id}: overflowing objectives card not fitted/focusable`,
          );
          await page.mouse.move(row.longCard.x, row.longCard.y);
          await page.mouse.wheel(0, 200);
          await page.waitForFunction(() => document.querySelector('[data-long-card]').scrollTop > 0, null, {
            timeout: 2000,
          });
          row.longCard.scrolled = await page.evaluate(() => document.querySelector('[data-long-card]').scrollTop);
        }
        await page.evaluate(() => document.querySelector('[data-long-card]')?.parentElement.remove());
        if (profile.id === 'compact')
          assert.ok(row.longCard.scrolled > 0, 'compact: the long objectives card did not scroll');
      }
      row.screenshot = `${route.template}-${route.scene}-${profile.id}.png`;
      await page.screenshot({path: resolve(out, row.screenshot)});
      if (route.traverse) {
        // Resume, then step the held clock through the board, sim and quiz scenes, tapping Next and turning the slider,
        // and check separation in every state reached. A short sample of the lesson, not a complete playthrough.
        await page.locator('[data-command="pause"]').tap();
        await page.evaluate(() => window.engine.clock.hold());
        const seen = new Set();
        for (let i = 0; i < 30 && !seen.has('.explorer-quiz'); i++) {
          await page.evaluate(() => {
            for (let k = 0; k < 40; k++) window.engine.clock.step(250);
          });
          await page.waitForTimeout(100);
          for (const s of await separation()) if (s.present) seen.add(s.pair[1]);
          if (await page.locator('.explorer-slider input').count())
            await page.locator('.explorer-slider input').fill('360');
          const next = page.locator('[data-command="next"]');
          if (await next.isEnabled()) await next.tap();
        }
        row.traversed = [...seen];
        row.scrolledPanels = scrolledPanels;
        for (const part of ['.chalkboard', '.explorer-slider', '.explorer-quiz'])
          assert.ok(seen.has(part), `${profile.id}: traversal never reached ${part}`);
        row.quizScreenshot = `${route.template}-${route.scene}-${profile.id}-quiz.png`;
        await page.screenshot({path: resolve(out, row.quizScreenshot)});
        await page.evaluate(() => window.engine.clock.resume());
        assert.deepEqual([...browser.errors, ...(await windowErrors())], []);
      }
      row.passed = true;
      await browser.close();
      browser = null;
    }
    await server.close();
    server = null;
  }
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser');
  await evidence.close(server, 'vite');
  evidence.finish();
}
console.log(`Stock touch routes passed (${report.cases.length}); evidence ${out}`);
