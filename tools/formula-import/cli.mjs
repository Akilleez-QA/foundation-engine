#!/usr/bin/env node
// tools/formula-import/cli.mjs (`npm run formulas:import -- <input> <output.json> --kind sheet|table|matrix [options]`):
// turn a spreadsheet export (CSV or TSV) into formula-kit JSON a game commits and loads with `defineFormulaSheet` or
// `defineFormulaTable` (@kits/formulas). The parsing and every check are the kit's own (src/kits/formulas/data.ts),
// so the command refuses exactly what a game would refuse when it loads the file.
//
//   npm run formulas:import -- balance.csv game/data/damage.json --kind sheet --source "balance sheet v3"
//   npm run formulas:import -- levels.tsv  game/data/levels.json --kind table
//   npm run formulas:import -- types.csv   game/data/types.json  --kind matrix --licence CC0-1.0 --author "Sam Rivera"
//   options: --delimiter <char|tab> (default: tab for .tsv/.tab/.txt, else comma), --source, --author, --licence, --note
//
// The output keeps `meta` (source, sourceSha256 of the input, author, licence, note) so a table recovered from an
// original game or a published reference stays attributable. Owner: the creator's command; it reads the input and
// writes only the output (temporary name, then rename). Bounds: the kit's 4,096 rows, 256 columns and 4,096-character
// cells, and 16 MiB of input.
import {createHash} from 'node:crypto';
import {readFileSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync} from 'node:fs';
import {basename, dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importFormulaSheet, importFormulaTable, parseDelimited} from '../../src/kits/formulas/data.ts';

const MAX_BYTES = 16 * 1024 * 1024;

export function parseArgs(argv) {
  const positional = [],
    flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (!['kind', 'delimiter', 'source', 'author', 'licence', 'note'].includes(name))
      throw Error(`unknown option --${name}`);
    if (Object.hasOwn(flags, name)) throw Error(`--${name} is given twice`);
    const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined || (eq < 0 && v.startsWith('--'))) throw Error(`--${name} needs a value`);
    flags[name] = v;
  }
  if (positional.length !== 2)
    throw Error('usage: formulas:import <input.csv|tsv> <output.json> --kind sheet|table|matrix');
  if (!['sheet', 'table', 'matrix'].includes(flags.kind)) throw Error('--kind must be sheet, table or matrix');
  if (extname(positional[1]).toLowerCase() !== '.json') throw Error('the output must be a .json file');
  return {input: positional[0], output: positional[1], flags};
}

export function importFile({input, output, flags}, cwd = process.cwd()) {
  const full = resolve(cwd, input);
  const size = statSync(full).size;
  if (size > MAX_BYTES) throw Error(`${input} is ${size} bytes, above ${MAX_BYTES}`);
  const bytes = readFileSync(full);
  // Tab for .tsv, .tab and .txt (spreadsheet "text" exports); comma otherwise; --delimiter overrides.
  const delimiter =
    flags.delimiter === 'tab' ? '\t' : (flags.delimiter ?? (/\.(tsv|tab|txt)$/i.test(input) ? '\t' : ','));
  const meta = {
    source: flags.source ?? basename(input),
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    ...(flags.author ? {author: flags.author} : {}),
    ...(flags.licence ? {licence: flags.licence} : {}),
    ...(flags.note ? {note: flags.note} : {}),
  };
  // Spreadsheets export UTF-8 (optionally with a BOM) or, as "Unicode text", UTF-16 with a BOM. Invalid bytes are
  // refused rather than silently replaced.
  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    text = new TextDecoder('utf-16le', {fatal: true}).decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff)
    text = new TextDecoder('utf-16be', {fatal: true}).decode(bytes.subarray(2));
  else {
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
      throw Error(`${input} is not valid UTF-8 or UTF-16 text; export it as CSV UTF-8`);
    }
  }
  const lines = [];
  const rows = parseDelimited(text, delimiter, undefined, lines);
  const data =
    flags.kind === 'sheet'
      ? importFormulaSheet(rows, {meta, lines})
      : importFormulaTable(rows, flags.kind, {meta, lines});
  const out = resolve(cwd, output);
  mkdirSync(dirname(out), {recursive: true});
  const tmp = `${out}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    renameSync(tmp, out);
  } finally {
    rmSync(tmp, {force: true});
  }
  const summary =
    flags.kind === 'sheet'
      ? {inputs: data.inputs.length, constants: Object.keys(data.constants).length, steps: data.steps.length}
      : {rows: data.rows.length, columns: data.columns.length};
  return {output: out, summary};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = importFile(parseArgs(process.argv.slice(2)));
    console.log(`wrote ${result.output} ${JSON.stringify(result.summary)}`);
  } catch (error) {
    console.error(`formulas:import: ${error.message}`);
    process.exitCode = 1;
  }
}
