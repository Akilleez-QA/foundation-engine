// scripts/lib/tool.mjs: start the repository's command-line tools (tsc, tsx, vite, prettier) and npm from a script the same way
// on Linux, macOS and Windows. `spawnSync('npx', …)` without a shell fails with ENOENT on Windows, where npx and the
// node_modules/.bin entries are `.cmd` files, and Node refuses to spawn a `.cmd` without a shell. So:
//   - a package's tool runs as `node <its JS bin entry> …args` (process.execPath plus the `bin` file from the package's
//     own package.json), with no shell and no npx: the arguments reach the tool unchanged on every platform;
//   - npm runs as `node <npm-cli.js> …args` when npm started this process (npm sets npm_execpath); else on Windows as
//     `node <node folder>\node_modules\npm\bin\npm-cli.js` (where the Node installer puts npm), and only when that
//     is absent through the shell as `npm.cmd` with each argument quoted; on POSIX as `npm`.
// Usage: const {command, args, shell} = toolCommand('tsc', ['--noEmit']); spawnSync(command, args, {shell, …}).
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, win32} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Which package provides each command (its package.json `bin` names the JS entry). */
export const TOOL_PACKAGES = {tsc: 'typescript', tsx: 'tsx', vite: 'vite', prettier: 'prettier'};

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
export function npmCommand(
  args = [],
  {env = process.env, platform = process.platform, execPath = process.execPath, exists = existsSync} = {},
) {
  const cli = env.npm_execpath;
  if (cli && /\.(c|m)?js$/.test(cli)) return {command: execPath, args: [cli, ...args], shell: false};
  if (platform === 'win32') {
    const bundled = win32.join(win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (exists(bundled)) return {command: execPath, args: [bundled, ...args], shell: false};
    // Last resort: cmd.exe joins the arguments with spaces, so quote each one (paths may contain spaces).
    return {
      command: 'npm.cmd',
      args: args.map(a => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)),
      shell: true,
    };
  }
  return {command: 'npm', args, shell: false};
}
