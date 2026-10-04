#!/usr/bin/env node
// scripts/host.mjs (`npm run host [-- --port 8787] [--lan] [--join <code>] [--integrity observe|enforce|off] [--game <dir>]`):
// a development-only reference host for a shared session (MP-01). It loads the game's `session.ts`
// (`defineSessionRules`) and runs those rules authoritatively with the network kit's `createSessionHost`, over
// maintained `ws` framing. Off unless you run it. Loopback only unless `--lan`. Unencrypted `ws://`, one shared join
// code per run, in-memory state, no accounts, matchmaking, NAT traversal or Internet hardening.
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import {join, relative} from 'node:path';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {WebSocketServer, WebSocket} from 'ws';
import {createSessionHost, isLocalNetworkHost} from '../src/kits/network/index.ts';
import {gameDir, ROOT} from './lib/game-dir.mjs';

/** Bytes a client may have waiting in the socket before the host stops admitting sends to it (that closes it). */
const MAX_BUFFERED = 262144;
export const DEFAULT_PORT = 8787;
/** A closed socket that has not finished the close handshake is terminated this long after the host's close. */
export const CLOSE_TERMINATE_MS = 1000;
export const SECURITY_WARNING =
  'Development only: unencrypted ws://, one shared join code, in-memory state, no accounts. ' +
  'Do not expose this host to the Internet or run it on a network you do not trust.';

/** Loopback names and addresses only: `localhost`, 127.0.0.0/8, ::1. */
export const isLoopbackHost = hostname => {
  const host = String(hostname)
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
};
/**
 * A join code passed with `--join` (to keep the same code across host restarts): 16-128 URL-safe characters with at
 * least 10 distinct ones, so a typed word or a repeated character is refused. Prefer the generated code.
 */
export function checkJoinCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(code))
    return 'the join code must be 16-128 characters of A-Z a-z 0-9 _ -';
  if (new Set(code).size < 10)
    return 'the join code needs at least 10 different characters; reuse a code the host generated';
  return null;
}

/** Load and check the game's shared rules (default export of `<game>/session.ts`). */
export async function loadSessionRules(dir = gameDir()) {
  const file = join(dir, 'session.ts');
  if (!existsSync(file)) {
    throw Object.assign(
      Error(
        `${relative(ROOT, file)} not found: this game defines no shared session. ` +
          'Start from the shared-world template (npm run new-game -- --template shared-world) or add a session.ts ' +
          'whose default export is defineSessionRules(...) from @kits/network.',
      ),
      {code: 'ENGINE_NO_SESSION'},
    );
  }
  const rules = (await import(pathToFileURL(file).href)).default;
  if (!rules || rules.kind !== 'session-rules')
    throw Error(`${relative(ROOT, file)} must default-export defineSessionRules(...)`);
  return rules;
}

/**
 * Start the WebSocket host. Returns `{url, port, joinCode, read, close}`. The timer and sockets belong to this owner;
 * `close()` stops the driver, closes every connection with `host-closing` and the server.
 */
export async function startSessionServer({
  rules,
  port = DEFAULT_PORT,
  host = '127.0.0.1',
  joinCode = randomBytes(18).toString('base64url'),
  integrity = 'observe',
  driverMs = 20,
  limits,
  log,
  lan = host !== '127.0.0.1',
} = {}) {
  const problem = checkJoinCode(joinCode);
  if (problem) throw Error(`host: ${problem}`);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw Error('host: port must be 0-65535');
  if (!Number.isSafeInteger(driverMs) || driverMs < 1 || driverMs > 1000) throw Error('host: driverMs must be 1-1000');
  const now = () => performance.now();
  const session = createSessionHost({
    rules,
    joinCode,
    integrity,
    limits,
    log,
    ports: {
      send(socket, text) {
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount + Buffer.byteLength(text) > MAX_BUFFERED)
          return false;
        socket.send(text);
        return true;
      },
      close(socket, code, reason) {
        if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
        // Do not keep a peer that never finishes the close handshake.
        setTimeout(() => socket.terminate(), CLOSE_TERMINATE_MS).unref();
      },
    },
  });
  const wss = new WebSocketServer({
    host,
    port,
    path: '/session',
    maxPayload: 8192,
    perMessageDeflate: false,
    // A browser always sends Origin. Loopback mode accepts only pages served from this machine's loopback names
    // (localhost, 127.x, ::1); LAN mode also accepts private LAN, link-local and .local/.localhost names. Any other
    // site is refused at the handshake. Clients without Origin (not browsers) still need the join code.
    verifyClient: ({origin}) => {
      if (!origin) return true;
      try {
        const name = new URL(origin).hostname;
        return lan ? isLocalNetworkHost(name) : isLoopbackHost(name);
      } catch {
        return false;
      }
    },
  });
  wss.on('connection', (socket, request) => {
    socket.on('error', () => {});
    // The remote address feeds the host's per-address cap on connections that have not joined yet.
    if (!session.connect(socket, now(), request.socket.remoteAddress)) return;
    socket.on('message', (data, binary) =>
      session.message(socket, binary ? '\u0000binary' : data.toString('utf8'), now()),
    );
    socket.on('close', () => session.disconnected(socket, now()));
  });
  try {
    await new Promise((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
  } catch (error) {
    // Nothing started: release the session and the half-open server so the caller's exit is clean.
    session.dispose();
    wss.close();
    throw error;
  }
  const timer = setInterval(() => session.pump(now()), driverMs);
  const bound = wss.address().port;
  let closing;
  return {
    url: `ws://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${bound}/session`,
    port: bound,
    joinCode,
    read: () => session.read(),
    close() {
      closing ??= new Promise(resolve => {
        clearInterval(timer);
        session.dispose();
        for (const socket of wss.clients) setTimeout(() => socket.terminate(), 200).unref();
        wss.close(() => resolve());
      });
      return closing;
    },
  };
}

const flag = name => {
  const args = process.argv.slice(2),
    i = args.findIndex(a => a === name || a.startsWith(name + '='));
  if (i < 0) return undefined;
  return args[i].includes('=')
    ? args[i].slice(name.length + 1)
    : args[i + 1] && !args[i + 1].startsWith('--')
      ? args[i + 1]
      : '';
};
const lanAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lan = process.argv.includes('--lan');
  const port = flag('--port') === undefined ? DEFAULT_PORT : Number(flag('--port'));
  const integrity = flag('--integrity') ?? 'observe';
  const joinCodeArg = flag('--join');
  if (joinCodeArg !== undefined && checkJoinCode(joinCodeArg)) {
    console.error(`\n  --join: ${checkJoinCode(joinCodeArg)}\n`);
    process.exit(2);
  }
  const playPort = Number(process.env.PORT ?? 5173);
  let rules;
  try {
    rules = await loadSessionRules();
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    process.exit(1);
  }
  const stamp = () => new Date().toISOString().slice(11, 19);
  const server = await startSessionServer({
    rules,
    port,
    host: lan ? '0.0.0.0' : '127.0.0.1',
    integrity,
    lan,
    ...(joinCodeArg === undefined ? {} : {joinCode: joinCodeArg}),
    log: ({event, player, reason}) =>
      console.log(`  ${stamp()} ${event}${player ? ' ' + player : ''}${reason ? ` (${reason})` : ''}`),
  }).catch(error => {
    if (error.code === 'EADDRINUSE')
      console.error(`\n  npm run host: port ${port} is busy; try npm run host -- --port ${port + 1}\n`);
    else console.error(`\n  Could not start the host: ${error.message}\n`);
    process.exit(1);
  });
  const scene = (await import(pathToFileURL(join(gameDir(), 'game.ts')).href)).default?.firstScene ?? '';
  const link = address =>
    `http://${address}:${playPort}/?host=${server.port}&join=${server.joinCode}${scene ? `#scene/${scene}` : ''}`;
  const lines = [
    '',
    `  Shared-session host: rules ${rules.id} v${rules.version}, up to ${rules.maxPlayers} players, integrity ${integrity}`,
    `  Listening on ${lan ? `all interfaces, port ${server.port} (LAN)` : `ws://127.0.0.1:${server.port}/session (this machine only)`}`,
    `  Join code: ${server.joinCode}  (${joinCodeArg === undefined ? 'new each run' : 'from --join'}; anyone with the code and network access can join)`,
    `  To restart with the same code (open tabs then reconnect by themselves): npm run host -- --join ${server.joinCode}`,
    '',
    `  Start the game in another terminal (npm run play${lan ? ' -- --host' : ''}), then open this link in two tabs:`,
    `    ${link('127.0.0.1')}`,
    ...(lan ? lanAddresses().map(a => `    ${link(a)}   (other devices on this network)`) : []),
    `  If npm run play printed another address or port, keep its address and add ?host=${server.port}&join=<code>.`,
    '',
    `  Warning: ${SECURITY_WARNING}`,
    ...(lan ? ['  LAN mode: every device on this network can reach the host while it runs.'] : []),
    '  Stop: Ctrl+C',
    '',
  ];
  console.log(lines.join('\n'));
  if (process.send) process.send({type: 'ready', url: server.url, port: server.port, joinCode: server.joinCode});
  process.on('message', async request => {
    if (!request || typeof request.id !== 'string' || request.id.length > 64) return;
    try {
      let value;
      if (request.method === 'read') value = server.read();
      else if (request.method === 'close') {
        await server.close();
        value = {closed: true};
      } else throw Error('operator-method');
      process.send?.({type: 'reply', id: request.id, value});
      if (request.method === 'close') process.disconnect?.();
    } catch (error) {
      process.send?.({type: 'reply', id: request.id, error: error.message});
    }
  });
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (process.send)
    process.once('disconnect', () => {
      void server.close();
    });
}
