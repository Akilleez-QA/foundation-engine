// scripts/lib/tool.mjs: start the repository's command-line tools (tsc, tsx, vite) and npm from a script the same way
// on Linux, macOS and Windows. `spawnSync('npx', …)` without a shell fails with ENOENT on Windows, where npx and the
// node_modules/.bin entries are `.cmd` files, and Node refuses to spawn a `.cmd` without a shell. So:
//   - a package's tool runs as `node <its JS bin entry> …args` (process.execPath plus the `bin` file from the package's
//     own package.json), with no shell and no npx: the arguments reach the tool unchanged on every platform;
//   - npm runs as `node <npm-cli.js> …args` when npm started this process (npm sets npm_execpath), else as `npm` on
//     POSIX and through the shell as `npm.cmd` on Windows (the arguments are fixed words, never user text).
// Usage: const {command, args, shell} = toolCommand('tsc', ['--noEmit']); spawnSync(command, args, {shell, …}).
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Which package provides each command (its package.json `bin` names the JS entry). */
export const TOOL_PACKAGES = {tsc: 'typescript', tsx: 'tsx', vite: 'vite'};

/** The absolute path of a package's JS bin entry for `bin` (default: the package's only or same-named bin). */
export function binEntry(pkg, bin = pkg, {from = ROOT} = {}) {
  const manifest = createRequire(join(from, 'package.json')).resolve(`${pkg}/package.json`);
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  const rel = typeof json.bin === 'string' ? json.bin : json.bin?.[bin];
  if (!rel) throw Error(`${pkg} declares no "${bin}" command in its package.json bin field`);
  return join(dirname(manifest), rel);
}

/** The command for one of the repository's tools: `node <bin entry> …args`, no shell. */
export function toolCommand(name, args = [], {from = ROOT} = {}) {
  const pkg = TOOL_PACKAGES[name];
  if (!pkg) throw Error(`unknown tool ${name}; known: ${Object.keys(TOOL_PACKAGES).join(', ')}`);
  return {command: process.execPath, args: [binEntry(pkg, name, {from}), ...args], shell: false};
}

/** The command for npm itself: npm's own CLI under this Node when npm started us, else the platform's npm. */
export function npmCommand(args = [], {env = process.env, platform = process.platform, execPath = process.execPath} = {}) {
  const cli = env.npm_execpath;
  if (cli && /\.(c|m)?js$/.test(cli)) return {command: execPath, args: [cli, ...args], shell: false};
  if (platform === 'win32') return {command: 'npm.cmd', args, shell: true};
  return {command: 'npm', args, shell: false};
}
