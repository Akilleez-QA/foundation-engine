// scripts/lint/format-check.mjs: `npm run format:check`. Prettier's check, and when it fails, the command that fixes it.
// Prettier lists the unformatted files but not the fix; a newcomer reading a failed lint should not have to guess.
// Usage: node scripts/lint/format-check.mjs [prettier file arguments; default: .]
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {toolCommand} from '../lib/tool.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Printed after a failed check. */
export const FIX_HINT = 'format:check failed: run `npm run format` to fix these files, then commit the result.';

/** The prettier command for a check of `files` (the whole tree by default). */
export function checkCommand(files = []) {
  return toolCommand('prettier', [
    '--check',
    '--log-level',
    'warn',
    ...(files.length ? ['--ignore-unknown', ...files] : ['.']),
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const {command, args, shell} = checkCommand(process.argv.slice(2));
  const r = spawnSync(command, args, {cwd: ROOT, stdio: 'inherit', shell});
  if (r.status !== 0) console.error(FIX_HINT);
  process.exit(r.status ?? 1);
}
