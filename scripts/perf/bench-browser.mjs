// scripts/perf/bench-browser.mjs: the bench's own browser (ADR 0046). Used by bench.mjs, gate.mjs and quality-guard.mjs.
// This file is hashed into the experiment descriptor: change it only when the measurement itself should change, and
// re-baseline when measurement semantics change. Additive options preserving defaults
// still change this hash and require fresh evidence, not a budget/baseline rewrite.
//
// - Browser: Chromium through Playwright (playwright-core; no browser download is ever triggered). The executable is
//   ENGINE_CHROMIUM when set (e.g. a GPU wrapper script), else Playwright's installed Chromium, else /usr/bin/chromium.
// - Isolation: a fresh browser process and a throwaway context per launch; the user's browser, profile and storage are
//   never touched. `--mute-audio` is always passed, and pages start with the `dev.silent` flag, so nothing can reach
//   the speakers; system and application audio settings are never changed.
// - Root: Chromium's sandbox cannot start as root (containers, CI), so `--no-sandbox` is added only when the bench runs
//   as uid 0. It is recorded in the launch arguments like every other flag.
// - Software GL by default (`--use-angle=swiftshader`), so runs are comparable on any machine; ENGINE_GPU=1 drops it.
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The Chromium the bench drives, and where that choice came from. */
export function chromiumExecutable(env = process.env, exists = existsSync, bundled = defaultBundled) {
  if (env.ENGINE_CHROMIUM) return {path: env.ENGINE_CHROMIUM, source: 'ENGINE_CHROMIUM'};
  const own = bundled();
  if (own && exists(own)) return {path: own, source: 'playwright'};
  return {path: '/usr/bin/chromium', source: 'system'};
}
function defaultBundled() {
  try { return createRequire(import.meta.url)('playwright-core').chromium.executablePath(); } catch { return null; }
}

/** The command-line flags: muted and isolated always; software GL unless `gpu`; no sandbox only as root. */
export function chromiumArgs({width = 1280, height = 800, gpu = false, root = process.getuid?.() === 0} = {}) {
  return [
    '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--enable-automation', '--ignore-gpu-blocklist', `--window-size=${width},${height}`,
    ...(gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ...(root ? ['--no-sandbox'] : []),
  ];
}

/**
 * Launch one muted, isolated headless page. Returns a small driver: `page` (Playwright), `cdp` (a CDP session for
 * metrics and heap), `evaluate`, `wait`, `key`, `errors` and `close`.
 */
export async function launch(options = {},
  launchBrowser = options => createRequire(import.meta.url)('playwright-core').chromium.launch(options)) {
  const {width = 1280, height = 800, gpu = process.env.ENGINE_GPU === '1', mobile = false,
    isMobile = mobile, hasTouch = mobile, deviceScaleFactor = 1, strictClose = false} = options;
  const exe = chromiumExecutable();
  const args = chromiumArgs({width, height, gpu});
  const browser = await launchBrowser({executablePath: exe.path, headless: true, args, ignoreDefaultArgs: ['--hide-scrollbars']});
  try {
    const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor, locale: 'en-US', timezoneId: 'UTC', isMobile, hasTouch});
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // Explicit capability requests use the existing session; some Chromium builds reset context touch emulation.
    // Legacy callers without hasTouch retain their previous setup sequence.
    if (options.hasTouch !== undefined) await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:hasTouch, maxTouchPoints:1});
    const errors = [];
    page.on('pageerror', e => errors.push(String(e?.message ?? e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const evaluate = expression => page.evaluate(expression);
    const b = {
      browser, context, page, cdp, errors, launchArguments: args, executable: exe,
      version: browser.version(),
      send: (method, params = {}) => cdp.send(method, params),
      evaluate,
      /** Polls a page expression until truthy; throws with the expression on timeout. */
      async wait(expr, ms = 30000) {
        const t = Date.now(); let last;
        while (Date.now() - t < ms) { try { if (await evaluate(expr)) return true; } catch (e) { last = e; } await sleep(100); }
        throw Error(`timeout ${ms} ms: ${expr}${last ? ' (' + last.message + ')' : ''}`);
      },
      async key(key, down = true) { if (down) await page.keyboard.down(key); else await page.keyboard.up(key); },
      async goto(url) { await page.goto(url, {waitUntil: 'load'}); },
      async close() { try { await browser.close(); } catch (error) { if (strictClose) throw error; /* Legacy callers permit an already-gone process. */ } },
    };
    return b;
  } catch (error) {
    try { await browser.close(); } catch { /* Preserve the initialization error after attempting cleanup. */ }
    throw error;
  }
}
