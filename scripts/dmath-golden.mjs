#!/usr/bin/env node
// scripts/dmath-golden.mjs (`npm run dmath:golden`): compare src/core/dmath.golden.json with what dmath computes in
// this Node, or rewrite it with `-- --write`. Rewriting changes the bits every engine must reproduce, so it is a
// deliberate change of the deterministic-math contract (existing replay logs that depend on it stop replaying).
// Run with `node --import tsx`.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dmath} from '../src/core/dmath.ts';
import {computeGolden} from '../src/core/dmath-vectors.ts';

const FILE = fileURLToPath(new URL('../src/core/dmath.golden.json', import.meta.url));
const cases = computeGolden(dmath);
const text =
  '{"format":"foundation.dmath-golden","version":1,"cases":{\n' +
  Object.entries(cases)
    .map(([fn, rows]) => `${JSON.stringify(fn)}:[\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]`)
    .join(',\n') +
  '\n}}\n';
if (process.argv.includes('--write')) {
  writeFileSync(FILE, text);
  console.log(`wrote ${FILE}`);
} else if (readFileSync(FILE, 'utf8') !== text) {
  console.error("dmath.golden.json differs from this engine's dmath");
  process.exit(1);
} else
  console.log(
    `dmath golden vectors match (${Object.values(cases).reduce((n, r) => n + r.length, 0)} cases, node ${process.versions.node}, V8 ${process.versions.v8})`,
  );
