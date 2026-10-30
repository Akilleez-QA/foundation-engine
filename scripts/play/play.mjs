#!/usr/bin/env node
// scripts/play/play.mjs (`npm run play [-- --host [address]] [--game <dir>]`): the dev server with the test API, for
// playing the game yourself. It listens on this machine only (127.0.0.1); `--host` (or ENGINE_HOST=1) also listens on
// the local network so a phone on the same Wi-Fi can open the printed Network URL. That exposes the dev server and its
// test API to everyone on that network: use it on a network you trust and stop the server when done.
import {isLoopback, listenHost, portBusyHint, serve, homeScene} from './lib.mjs';

const host = listenHost();
const port = Number(process.env.PORT ?? 5173);
const started = await serve({port, host, watch: true}).catch(error => {
  if (error.code !== 'EADDRINUSE') throw error;
  // Another server (often an earlier `npm run play`) has the port: one line and a non-zero exit, not a stack trace.
  console.error(`\n  npm run play: ${portBusyHint(port, next => `PORT=${next} npm run play`)}\n`);
  process.exit(1);
});
const {url, network} = started;
const hash = `#scene/${homeScene()}`;
const lan = isLoopback(host)
  ? '  Phone on the same Wi-Fi: npm run play -- --host\n'
  : network.length
    ? `${network.map(u => `  Network: ${u}/${hash}`).join('\n')}\n  Warning: anyone on this network can open the dev server and its test API while it runs.\n`
    : `  Listening on ${host === true ? 'all interfaces' : host}, but no network address was found (is Wi-Fi connected?).\n`;
console.log(
  `\n  Play: ${url}/${hash}\n${lan}  Sound: press M to mute; test browsers are always muted.\n  Stop: Ctrl+C\n`,
);
