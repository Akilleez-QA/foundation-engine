#!/usr/bin/env node
/**
 * The generators that must run before `tsc` (ADR 0043: generated files are never committed and are rebuilt by the
 * gate, the build and the deploy guard):
 *   1. `scripts/strings.mjs` writes `src/core/i18n/keys.gen.ts` (the typed string keys `t()` checks), the narration
 *      catalogue and the compact ids, from the string shards.
 */
import './lib/node-version.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const args of [['scripts/strings.mjs']]) {
  const r = spawnSync(process.execPath, args, {cwd: root, stdio: 'inherit'});
  if (r.status !== 0) {
    console.error(`generate: node ${args.join(' ')} failed`);
    process.exit(r.status ?? 1);
  }
}
