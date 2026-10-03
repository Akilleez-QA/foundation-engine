// scripts/perf/bench-browser.mjs: the bench's own browser (ADR 0046). Used by bench.mjs, gate.mjs and quality-guard.mjs.
// This file is hashed into the experiment descriptor: change it only when the measurement itself should change, and
// re-baseline when measurement semantics change. Additive options preserving defaults
// still change this hash and require fresh evidence, not a budget/baseline rewrite.
//
// - Browser: Chromium through Playwright (playwright-core; no browser download is ever triggered). The executable is
//   ENGINE_CHROMIUM when set (e.g. a GPU wrapper script), else Playwright's installed Chromium
//   (`npx playwright-core install chromium`), else an installed Chrome or Chromium in its usual folder for the OS
//   (SYSTEM_CHROMIUM; ENGINE_CHROMIUM_SYSTEM=0 skips them). On Linux the real binary (/usr/lib/chromium/chromium...)
//   comes before the /usr/bin launcher: distribution launchers such as /usr/bin/chromium read the user's own flag files
//   (~/.config/chromium-flags.conf, /etc/chromium.d), which would change the measured browser's flags behind the bench.
//   When no browser is found, launch() throws one line with the install command (BROWSER_HELP); when one exists but
//   cannot start (missing system libraries, a broken wrapper...), it throws the first lines of the cause and
//   START_HELP instead. Both keep the original error as `cause`.
// - Isolation: a fresh browser process and a throwaway context per launch; the user's browser, profile and storage are
//   never touched. `--mute-audio` is always passed, and pages start with the `dev.silent` flag, so nothing can reach
//   the speakers; system and application audio settings are never changed.
// - Root: Chromium's sandbox cannot start as root (containers, CI), so `--no-sandbox` is added only when the bench runs
//   as uid 0. It is recorded in the launch arguments like every other flag.
// - Software GL by default (`--use-angle=swiftshader`), so runs are comparable on any machine; ENGINE_GPU=1 drops it.
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Installed Chrome/Chromium executables per OS, in preference order (real binaries before launcher scripts). */
export function systemChromiums(platform = process.platform, env = process.env) {
  if (platform === 'darwin')
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ...(env.HOME
        ? [
            `${env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
            `${env.HOME}/Applications/Chromium.app/Contents/MacOS/Chromium`,
          ]
        : []),
    ];
  if (platform === 'win32')
    return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
      .filter(Boolean)
      .flatMap(base => [
        `${base}\\Google\\Chrome\\Application\\chrome.exe`,
        `${base}\\Chromium\\Application\\chrome.exe`,
      ]);
  return [
    '/usr/lib/chromium/chromium',
    '/usr/lib64/chromium-browser/chromium-browser',
    '/usr/lib/chromium-browser/chromium-browser',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium',
  ];
}

/** The one message for a missing or unstartable test browser. */
export const BROWSER_HELP =
  'Install the test browser with `npx playwright-core install chromium` ' +
  '(Linux may also need `npx playwright-core install-deps chromium`), or set ENGINE_CHROMIUM to a Chrome or Chromium executable.';

/** The advice when a browser exists but does not start. */
export const START_HELP =
  'On Linux, missing system libraries are installed with `npx playwright-core install-deps chromium` (needs root); ' +
  'or set ENGINE_CHROMIUM to a working Chrome or Chromium executable.';

/** True when a launch failure means the executable itself is absent (rather than present but failing). */
export function executableMissing(exe, cause, exists = existsSync) {
  return !exe.path || !exists(exe.path) || /executable doesn't exist/i.test(String(cause?.message ?? cause));
}

/** For command-line entries: print a test-browser error (no stack) and return true; false for any other error. */
export function reportBrowserError(error) {
  if (error?.code !== 'ENGINE_NO_BROWSER') return false;
  console.error(error.message);
  process.exitCode = 1;
  return true;
}

/** The Chromium the bench drives, and where that choice came from (path null when none is found). */
export function chromiumExecutable(
  env = process.env,
  exists = existsSync,
  bundled = defaultBundled,
  platform = process.platform,
) {
  if (env.ENGINE_CHROMIUM) return {path: env.ENGINE_CHROMIUM, source: 'ENGINE_CHROMIUM'};
  const own = bundled();
  if (own && exists(own)) return {path: own, source: 'playwright'};
  if (env.ENGINE_CHROMIUM_SYSTEM !== '0')
    for (const path of systemChromiums(platform, env)) if (exists(path)) return {path, source: 'system'};
  return {path: null, source: 'none'};
}
function defaultBundled() {
  try {
    return createRequire(import.meta.url)('playwright-core').chromium.executablePath();
  } catch {
    return null;
  }
}

/** The command-line flags: muted and isolated always; software GL unless `gpu`; no sandbox only as root. */
export function chromiumArgs({width = 1280, height = 800, gpu = false, root = process.getuid?.() === 0} = {}) {
  return [
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--enable-automation',
    '--ignore-gpu-blocklist',
    `--window-size=${width},${height}`,
    ...(gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ...(root ? ['--no-sandbox'] : []),
  ];
}

/**
 * Launch one muted, isolated headless page. Returns a small driver: `page` (Playwright), `cdp` (a CDP session for
 * metrics and heap), `evaluate`, `wait`, `key`, `errors` and `close`.
 */
export async function launch(
  options = {},
  launchBrowser = options => createRequire(import.meta.url)('playwright-core').chromium.launch(options),
) {
  const {
    width = 1280,
    height = 800,
    gpu = process.env.ENGINE_GPU === '1',
    mobile = false,
    isMobile = mobile,
    hasTouch = mobile,
    deviceScaleFactor = 1,
    strictClose = false,
  } = options;
  const exe = chromiumExecutable();
  const args = chromiumArgs({width, height, gpu});
  let browser;
  try {
    browser = await launchBrowser({
      executablePath: exe.path ?? undefined,
      headless: true,
      args,
      ignoreDefaultArgs: ['--hide-scrollbars'],
    });
  } catch (cause) {
    const lines = String(cause?.message ?? cause)
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    let message;
    if (!exe.path)
      message = `No test browser found (looked for ENGINE_CHROMIUM, Playwright's Chromium and an installed Chrome or Chromium). ${BROWSER_HELP}`;
    else if (executableMissing(exe, cause))
      message = `The test browser ${exe.path} (${exe.source}) does not exist. ${BROWSER_HELP}`;
    else
      message = `Could not start the test browser ${exe.path} (${exe.source}):\n  ${(lines.length ? lines : ['unknown error']).slice(0, 8).join('\n  ')}\n${START_HELP}`;
    throw Object.assign(Error(message, {cause}), {code: 'ENGINE_NO_BROWSER'});
  }
  try {
    const context = await browser.newContext({
      viewport: {width, height},
      deviceScaleFactor,
      locale: 'en-US',
      timezoneId: 'UTC',
      isMobile,
      hasTouch,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // Explicit capability requests use the existing session; some Chromium builds reset context touch emulation.
    // Legacy callers without hasTouch retain their previous setup sequence.
    if (options.hasTouch !== undefined)
      await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: hasTouch, maxTouchPoints: 1});
    const errors = [];
    page.on('pageerror', e => errors.push(String(e?.message ?? e)));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const evaluate = expression => page.evaluate(expression);
    const b = {
      browser,
      context,
      page,
      cdp,
      errors,
      launchArguments: args,
      executable: exe,
      version: browser.version(),
      send: (method, params = {}) => cdp.send(method, params),
      evaluate,
      /** Polls a page expression until truthy; throws with the expression on timeout. */
      async wait(expr, ms = 30000) {
        const t = Date.now();
        let last;
        while (Date.now() - t < ms) {
          try {
            if (await evaluate(expr)) return true;
          } catch (e) {
            last = e;
          }
          await sleep(100);
        }
        throw Error(`timeout ${ms} ms: ${expr}${last ? ' (' + last.message + ')' : ''}`);
      },
      async key(key, down = true) {
        if (down) await page.keyboard.down(key);
        else await page.keyboard.up(key);
      },
      async goto(url) {
        await page.goto(url, {waitUntil: 'load'});
      },
      async close() {
        try {
          await browser.close();
        } catch (error) {
          if (strictClose) throw error; /* Legacy callers permit an already-gone process. */
        }
      },
    };
    return b;
  } catch (error) {
    try {
      await browser.close();
    } catch {
      /* Preserve the initialization error after attempting cleanup. */
    }
    throw error;
  }
}
