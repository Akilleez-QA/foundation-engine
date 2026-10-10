import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {importFile, parseArgs} from './cli.mjs';
import {defineFormulaSheet, defineFormulaTable, evaluateSheet, tableValue} from '../../src/kits/formulas/index.ts';

test('formulas:import writes kit JSON with attributable meta that loads in the kit', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'formula-import-'));
  try {
    writeFileSync(
      join(dir, 'sheet.csv'),
      'kind,id,value\ninput,attack,\nconstant,bonus,3\nstep,total,attack + bonus\n',
    );
    writeFileSync(join(dir, 'types.tsv'), '\tFire\tWater\nFire\t0.5\t0.5\nWater\t2\t0.5\n');
    const s = importFile(parseArgs(['sheet.csv', 'out/sheet.json', '--kind', 'sheet', '--licence', 'CC0-1.0']), dir);
    assert.deepEqual(s.summary, {inputs: 1, constants: 1, steps: 1});
    const sheetJson = JSON.parse(readFileSync(join(dir, 'out/sheet.json'), 'utf8'));
    assert.equal(sheetJson.meta.source, 'sheet.csv');
    assert.match(sheetJson.meta.sourceSha256, /^[0-9a-f]{64}$/);
    assert.equal(evaluateSheet(defineFormulaSheet(sheetJson), {attack: 4}).value, 7);
    importFile(parseArgs(['types.tsv', 'out/types.json', '--kind', 'matrix', '--note', 'example']), dir);
    const chart = defineFormulaTable(JSON.parse(readFileSync(join(dir, 'out/types.json'), 'utf8')));
    assert.equal(tableValue(chart, 'Water', 'Fire'), 2);
    writeFileSync(join(dir, 'bad.csv'), 'kind,id,value\nstep,x,nope +\n');
    assert.throws(() => importFile(parseArgs(['bad.csv', 'out/bad.json', '--kind', 'sheet']), dir), /line 2/);
    // UTF-16 "Unicode text" exports with tabs, `--kind=` form; invalid UTF-8 refused; repeated or valueless flags refused
    writeFileSync(
      join(dir, 'u16.txt'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('level\thp\n1\t20\n', 'utf16le')]),
    );
    const u = importFile(parseArgs(['u16.txt', 'out/u16.json', '--kind=table']), dir);
    assert.deepEqual(u.summary, {rows: 1, columns: 1});
    writeFileSync(join(dir, 'bad8.csv'), Buffer.from([0x6b, 0x2c, 0x76, 0x0a, 0xc3, 0x28, 0x2c, 0x31, 0x0a]));
    assert.throws(() => importFile(parseArgs(['bad8.csv', 'out/b.json', '--kind', 'matrix']), dir), /not valid UTF-8/);
    assert.throws(() => parseArgs(['a.csv', 'b.json', '--kind', 'table', '--kind', 'sheet']), /given twice/);
    assert.throws(() => parseArgs(['a.csv', 'b.json', '--note', '--kind', 'table']), /--note needs a value/);
    assert.equal(existsSync(join(dir, 'out/bad.json')), false, 'a refusal writes nothing');
    assert.throws(() => parseArgs(['a.csv', 'b.json']), /--kind/);
    assert.throws(() => parseArgs(['a.csv', 'b.txt', '--kind', 'table']), /\.json/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
