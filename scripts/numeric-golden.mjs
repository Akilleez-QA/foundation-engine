#!/usr/bin/env node
// scripts/numeric-golden.mjs (`npm run numeric:golden`): compare src/kits/numeric/numeric.golden.json with what the
// numeric kit computes in this engine, or rewrite it with `-- --write`. Rewriting changes the integers and bits every
// engine must reproduce, so it is a deliberate change of the kit's deterministic contract (replay logs and lockstep
// peers that depend on it stop agreeing). Run with `node --import tsx`.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {computeNumericGolden, computeWorkloadDigests, numericGoldenText} from '../src/kits/numeric/vectors.ts';

const FILE = fileURLToPath(new URL('../src/kits/numeric/numeric.golden.json', import.meta.url));
const text = numericGoldenText(computeNumericGolden(), computeWorkloadDigests());
if (process.argv.includes('--write')) {
  writeFileSync(FILE, text);
  console.log(`wrote ${FILE}`);
} else if (readFileSync(FILE, 'utf8') !== text) {
  console.error('numeric.golden.json differs from what this engine computes');
  process.exit(1);
} else console.log(`numeric golden vectors match (node ${process.versions.node}, V8 ${process.versions.v8})`);
