import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_HELP,
  START_HELP,
  chromiumExecutable,
  executableMissing,
  launch,
  reportBrowserError,
  systemChromiums,
} from './bench-browser.mjs';

test('browser options preserve legacy mobile defaults and allow independent touch, mobile and DPR', async () => {
  for (const [options, expected] of [
    [{}, {isMobile: false, hasTouch: false, deviceScaleFactor: 1}],
    [{mobile: true}, {isMobile: true, hasTouch: true, deviceScaleFactor: 1}],
    [
      {mobile: true, isMobile: false, hasTouch: true, deviceScaleFactor: 2},
      {isMobile: false, hasTouch: true, deviceScaleFactor: 2},
    ],
  ]) {
    let contextOptions,
      closes = 0;
    const browser = {
      version: () => 'mock',
      close: async () => {
        closes++;
      },
      newContext: async opts => {
        contextOptions = opts;
        return {newPage: async () => ({on() {}}), newCDPSession: async () => ({send: async () => {}})};
      },
    };
    const b = await launch(options, async () => browser);
    for (const [key, value] of Object.entries(expected)) assert.equal(contextOptions[key], value);
    assert.deepEqual(contextOptions.viewport, {width: 1280, height: 800});
    await b.close();
    assert.equal(closes, 1);
  }
});

test('browser initialization failures close the launched process and preserve original cause', async () => {
  for (const stage of ['context', 'page', 'cdp']) {
    const cause = Error(stage);
    let closes = 0;
    const browser = {
      close: async () => {
        closes++;
        throw Error('cleanup');
      },
      newContext: async () => {
        if (stage === 'context') throw cause;
        return {
          newPage: async () => {
            if (stage === 'page') throw cause;
            return {};
          },
          newCDPSession: async () => {
            throw cause;
          },
        };
      },
    };
    await assert.rejects(
      launch({}, async () => browser),
      error => error === cause,
    );
    assert.equal(closes, 1);
  }
});

test('strict browser cleanup surfaces failures while legacy cleanup remains best effort', async () => {
  for (const strictClose of [false, true]) {
    const cause = Error('close failed');
    const browser = {
      version: () => 'mock',
      close: async () => {
        throw cause;
      },
      newContext: async () => ({
        newPage: async () => ({on() {}}),
        newCDPSession: async () => ({send: async () => {}}),
      }),
    };
    const b = await launch({strictClose}, async () => browser);
    if (strictClose) await assert.rejects(b.close(), error => error === cause);
    else await b.close();
  }
});

test('explicit touch capability is set on the existing CDP session, legacy requests add no command', async () => {
  for (const hasTouch of [undefined, false, true]) {
    const commands = [];
    const browser = {
      version: () => 'mock',
      close: async () => {},
      newContext: async () => ({
        newPage: async () => ({on() {}}),
        newCDPSession: async () => ({send: async (...args) => commands.push(args)}),
      }),
    };
    const b = await launch(hasTouch === undefined ? {} : {hasTouch}, async () => browser);
    assert.deepEqual(
      commands,
      hasTouch === undefined ? [] : [['Emulation.setTouchEmulationEnabled', {enabled: hasTouch, maxTouchPoints: 1}]],
    );
    await b.close();
  }
});

test("executable order: ENGINE_CHROMIUM, then Playwright's Chromium, then an installed Chrome/Chromium, else none", () => {
  const all = () => true,
    none = () => false,
    bundled = () => '/pw/chrome';
  assert.deepEqual(chromiumExecutable({ENGINE_CHROMIUM: '/x/chrome'}, none, bundled, 'linux'), {
    path: '/x/chrome',
    source: 'ENGINE_CHROMIUM',
  });
  assert.deepEqual(chromiumExecutable({}, all, bundled, 'linux'), {path: '/pw/chrome', source: 'playwright'});
  assert.deepEqual(
    chromiumExecutable({}, p => p === '/usr/bin/chromium', bundled, 'linux'),
    {path: '/usr/bin/chromium', source: 'system'},
  );
  assert.deepEqual(
    chromiumExecutable({}, none, () => null, 'linux'),
    {path: null, source: 'none'},
  );
  assert.deepEqual(
    chromiumExecutable({ENGINE_CHROMIUM_SYSTEM: '0'}, p => p !== '/pw/chrome', bundled, 'linux'),
    {path: null, source: 'none'},
    'system browsers can be skipped',
  );
  const mac = chromiumExecutable(
    {HOME: '/Users/a'},
    p => p.startsWith('/Applications/Google Chrome.app'),
    () => null,
    'darwin',
  );
  assert.equal(mac.path, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const win = chromiumExecutable(
    {LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local'},
    p => p.endsWith('\\Google\\Chrome\\Application\\chrome.exe'),
    () => null,
    'win32',
  );
  assert.equal(win.path, 'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
});

test('on Linux the real Chromium binary comes before the /usr/bin launcher that applies user flag files', () => {
  const linux = systemChromiums('linux', {});
  assert.ok(linux.indexOf('/usr/lib/chromium/chromium') < linux.indexOf('/usr/bin/chromium'));
  assert.ok(linux.indexOf('/opt/google/chrome/chrome') < linux.indexOf('/usr/bin/google-chrome'));
  assert.deepEqual(systemChromiums('win32', {}), [], 'no Windows candidates without its folder variables');
});

test('a missing or unstartable browser is one actionable message with the install command; the cause is kept', async () => {
  const prior = {ENGINE_CHROMIUM: process.env.ENGINE_CHROMIUM};
  try {
    process.env.ENGINE_CHROMIUM = '/nonexistent/chrome';
    const cause = Error(
      "browserType.launch: Failed to launch chromium because executable doesn't exist at /nonexistent/chrome\n=== logs ===\nmore",
    );
    await assert.rejects(
      launch({}, async () => {
        throw cause;
      }),
      error => {
        assert.equal(error.code, 'ENGINE_NO_BROWSER');
        assert.equal(error.cause, cause);
        assert.ok(!error.message.includes('\n'), 'one line');
        assert.match(error.message, /\/nonexistent\/chrome \(ENGINE_CHROMIUM\)/);
        assert.ok(
          error.message.includes('npx playwright-core install chromium') && error.message.includes('ENGINE_CHROMIUM'),
        );
        assert.ok(error.message.endsWith(BROWSER_HELP));
        return true;
      },
    );
  } finally {
    if (prior.ENGINE_CHROMIUM === undefined) delete process.env.ENGINE_CHROMIUM;
    else process.env.ENGINE_CHROMIUM = prior.ENGINE_CHROMIUM;
  }
  const lines = [];
  const log = console.error;
  const exit = process.exitCode;
  console.error = line => lines.push(line);
  try {
    assert.equal(
      reportBrowserError(Object.assign(Error('No test browser found. ' + BROWSER_HELP), {code: 'ENGINE_NO_BROWSER'})),
      true,
    );
    assert.equal(reportBrowserError(Error('other')), false);
    assert.deepEqual(lines, ['No test browser found. ' + BROWSER_HELP]);
  } finally {
    console.error = log;
    process.exitCode = exit;
  }
});

test('a browser that exists but fails to start shows the cause lines and start advice, not the install advice', async () => {
  const prior = process.env.ENGINE_CHROMIUM;
  try {
    process.env.ENGINE_CHROMIUM = process.execPath; // exists on every machine
    const cause = Error(
      'browserType.launch: \n╔══════╗\n║ Host system is missing dependencies to run browsers. ║\n║ libnss3.so ║\n╚══════╝',
    );
    await assert.rejects(
      launch({}, async () => {
        throw cause;
      }),
      error => {
        assert.equal(error.code, 'ENGINE_NO_BROWSER');
        assert.equal(error.cause, cause);
        assert.match(error.message, /Could not start the test browser/);
        assert.ok(
          error.message.includes('Host system is missing dependencies') && error.message.includes('libnss3.so'),
          'the cause lines are shown',
        );
        assert.ok(error.message.endsWith(START_HELP));
        assert.ok(!error.message.includes(BROWSER_HELP), 'not told to install a browser that exists');
        return true;
      },
    );
  } finally {
    if (prior === undefined) delete process.env.ENGINE_CHROMIUM;
    else process.env.ENGINE_CHROMIUM = prior;
  }
  assert.equal(executableMissing({path: null}, Error('x')), true);
  assert.equal(
    executableMissing({path: '/a'}, Error('x'), () => false),
    true,
  );
  assert.equal(
    executableMissing({path: '/a'}, Error("Executable doesn't exist at /a"), () => true),
    true,
  );
  assert.equal(
    executableMissing({path: '/a'}, Error('crashed'), () => true),
    false,
  );
});

test('the GPU harness points ANGLE at a hardware backend on Linux and detects a software fallback', async () => {
  const {chromiumArgs, gpuAngleArgs, isSoftwareRenderer} = await import('./bench-browser.mjs');
  const linux = chromiumArgs({gpu: true, platform: 'linux', env: {}, root: false});
  assert.ok(linux.includes('--use-gl=angle') && linux.includes('--use-angle=gl-egl'));
  assert.ok(!linux.some(a => a.includes('swiftshader')), 'no software flags in the GPU harness');
  const soft = chromiumArgs({gpu: false, platform: 'linux', env: {}, root: false});
  assert.ok(soft.includes('--use-angle=swiftshader') && !soft.includes('--use-gl=angle'), 'software default unchanged');
  assert.deepEqual(gpuAngleArgs('darwin', {}), []);
  assert.deepEqual(gpuAngleArgs('win32', {}), []);
  assert.deepEqual(gpuAngleArgs('linux', {ENGINE_GPU_ANGLE: 'default'}), []);
  assert.deepEqual(gpuAngleArgs('linux', {ENGINE_GPU_ANGLE: 'vulkan'}), [
    '--use-gl=angle',
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
  ]);
  assert.throws(() => gpuAngleArgs('linux', {ENGINE_GPU_ANGLE: 'gl --no-sandbox'}), /ANGLE backend name/);
  assert.ok(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'));
  assert.ok(isSoftwareRenderer('llvmpipe (LLVM 17.0.6, 256 bits)'));
  assert.ok(!isSoftwareRenderer('ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4080/PCIe/SSE2, OpenGL ES 3.2)'));
});
