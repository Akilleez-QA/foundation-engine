// A busy port is an everyday newcomer mistake (an earlier `npm run play` still running): the server commands print one
// line naming the next port to try and exit non-zero, never a raw stack trace.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {isPortBusy, portBusyHint, serve} from './lib.mjs';
import {ROOT} from '../lib/game-dir.mjs';

/** Holds a loopback port until released. */
async function occupy() {
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  return {port: blocker.address().port, release: () => new Promise(resolve => blocker.close(resolve))};
}

/** Runs a script to its exit and collects both streams. */
function run(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {...process.env, ...env},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const timer = setTimeout(() => child.kill(), 30000);
  return new Promise(resolve =>
    child.once('close', code => {
      clearTimeout(timer);
      resolve({code, stdout, stderr});
    }),
  );
}

const stackLine = /^\s+at .+[:(]/m;

test('isPortBusy knows Node and Vite busy-port errors and nothing else', () => {
  assert.equal(
    isPortBusy(Object.assign(Error('listen EADDRINUSE: address already in use 127.0.0.1:5173'), {code: 'EADDRINUSE'})),
    true,
  );
  assert.equal(isPortBusy(Error('Port 5173 is already in use')), true);
  assert.equal(isPortBusy(Error('Cannot find module vite')), false);
  assert.equal(isPortBusy(undefined), false);
  assert.equal(
    portBusyHint(5173, next => `PORT=${next} npm run play`),
    'port 5173 is busy; try PORT=5174 npm run play',
  );
});

test('serve: a taken port rejects with code EADDRINUSE and the port', {timeout: 60000}, async () => {
  const held = await occupy();
  try {
    await assert.rejects(
      serve({port: held.port}),
      error => error.code === 'EADDRINUSE' && error.port === held.port && error.message === `port ${held.port} is busy`,
    );
  } finally {
    await held.release();
  }
});

test('npm run play on a busy port prints the one-line hint and exits 1', {timeout: 60000}, async () => {
  const held = await occupy();
  try {
    const {code, stdout, stderr} = await run(['scripts/play/play.mjs'], {PORT: String(held.port)});
    assert.equal(code, 1);
    assert.equal(stderr.trim(), `npm run play: port ${held.port} is busy; try PORT=${held.port + 1} npm run play`);
    assert.doesNotMatch(stderr + stdout, stackLine);
  } finally {
    await held.release();
  }
});

test('npm run host on a busy port prints the one-line hint and exits 1', {timeout: 60000}, async () => {
  const held = await occupy();
  try {
    const {code, stdout, stderr} = await run([
      '--import',
      'tsx',
      'scripts/host.mjs',
      '--port',
      String(held.port),
      '--game',
      'templates/shared-world/game',
    ]);
    assert.equal(code, 1);
    assert.equal(stderr.trim(), `npm run host: port ${held.port} is busy; try npm run host -- --port ${held.port + 1}`);
    assert.doesNotMatch(stderr + stdout, stackLine);
  } finally {
    await held.release();
  }
});
