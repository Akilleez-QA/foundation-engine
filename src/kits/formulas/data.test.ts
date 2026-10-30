import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  defineFormulaSheet,
  defineFormulaTable,
  evaluateSheet,
  FormulaError,
  importFormulaSheet,
  importFormulaTable,
  parseDelimited,
  tableRow,
  tableValue,
} from './index';

test('formula data: delimited text follows RFC 4180 quoting, CRLF, BOM and blank lines', () => {
  const text =
    '﻿kind,id,value\r\nstep,amount,"max(1, attack - defense)"\r\n\r\nconstant,"say ""hi""",2\nstep,multi,"a\nb"\n';
  assert.deepEqual(parseDelimited(text), [
    ['kind', 'id', 'value'],
    ['step', 'amount', 'max(1, attack - defense)'],
    ['constant', 'say "hi"', '2'],
    ['step', 'multi', 'a\nb'],
  ]);
  assert.deepEqual(parseDelimited('a\tb\n1\t2', '\t'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.throws(() => parseDelimited('"open'), /not closed/);
  assert.throws(() => parseDelimited('a"b,c'), /quote inside an unquoted cell/);
  assert.throws(() => parseDelimited('"a"b'), /text after a closing quote/);
  assert.throws(() => parseDelimited('a,b,c', ',', {maxColumns: 2}), /more than 2 columns/);
  assert.throws(() => parseDelimited('1\n2\n3', ',', {maxRows: 2}), /more than 2 rows/);
  assert.throws(() => parseDelimited('x', '"'), FormulaError);
});

const SHEET = `kind,id,value
input,attack,
input,defense,
input,critRate,
constant,critMultiplier,1.5
step,crit,chance(critRate)
step,amount,"max(1, attack - defense) * if(crit, critMultiplier, 1)"
`;

test('formula data: a spreadsheet sheet imports to the same sheet a creator would write by hand', () => {
  const imported = importFormulaSheet(parseDelimited(SHEET), {meta: {source: 'balance.csv', licence: 'CC0-1.0'}});
  assert.deepEqual(imported.inputs, ['attack', 'defense', 'critRate']);
  assert.deepEqual(imported.constants, {critMultiplier: 1.5});
  assert.equal(imported.meta?.source, 'balance.csv');
  // The committed JSON round-trips into defineFormulaSheet and evaluates like the hand-written form.
  const fromJson = defineFormulaSheet(JSON.parse(JSON.stringify(imported)));
  const byHand = defineFormulaSheet({
    inputs: ['attack', 'defense', 'critRate'],
    constants: {critMultiplier: 1.5},
    steps: [
      {id: 'crit', expr: {text: 'chance(critRate)'}},
      {id: 'amount', expr: {text: 'max(1, attack - defense) * if(crit, critMultiplier, 1)'}},
    ],
  });
  for (const draw of [0.05, 0.5]) {
    const inputs = {attack: 40, defense: 12, critRate: 0.1};
    assert.deepEqual(
      evaluateSheet(fromJson, inputs, {random: () => draw}).values,
      evaluateSheet(byHand, inputs, {random: () => draw}).values,
    );
  }
});

test('formula data: sheet refusals name the spreadsheet row', () => {
  const rows = (body: string) => parseDelimited(`kind,id,value\n${body}`);
  assert.throws(() => importFormulaSheet(rows('input,a,\nstep,b,a + missing\n')), /row 3 \(b\)/);
  assert.throws(() => importFormulaSheet(rows('input,a,\ninput,a,\n')), /row 3: a is already defined on row 2/);
  // With line numbers from the parser, blank lines and `,,` rows do not shift the reported line.
  const lines: number[] = [];
  const parsed = parseDelimited('kind,id,value\n\n,,\ninput,a,\nstep,b,a + zz\n', ',', undefined, lines);
  assert.throws(() => importFormulaSheet(parsed, {lines}), /line 5 \(b\)/);
  // Problems with inputs or constants are not blamed on a step.
  const many = Array.from({length: 65}, (_, i) => `constant,k${i},1`).join('\n');
  assert.throws(
    () => importFormulaSheet(rows(`${many}\nstep,s,k0\n`)),
    /^FormulaError: formulas: inputs and constants:/,
  );
  assert.throws(() => importFormulaSheet(rows('constant,k,1e999\n')), /row 2 value: 1e999 is not finite/);
  assert.throws(() => importFormulaSheet(rows('constant,k,"1,5"\n')), /is not a number/);
  assert.throws(() => importFormulaSheet(rows('constant,k,0x10\n')), /is not a number/);
  assert.throws(() => importFormulaSheet(rows('rule,k,1\n')), /kind must be input, constant or step/);
  assert.throws(() => importFormulaSheet(rows('input,1abc,\n')), /not a usable name/);
  assert.throws(() => importFormulaSheet(rows('input,a,5\n')), /an input has no value/);
  assert.throws(() => importFormulaSheet(rows('step,s,\n')), /needs formula text/);
  assert.throws(() => importFormulaSheet(rows('input,a,,extra\n')), /extra cells/);
});

const LEVELS = `level,hp,attack,xpToNext
1,20,5,100
2,26,7,250
12,140,41,9800
`;
const CHART = `,Fire,Water,Grass
Fire,0.5,0.5,2
Water,2,0.5,0.5
Grass,0.5,2,0.5
`;

test('formula data: tables and matrices import, freeze and feed sheet inputs', () => {
  const levels = defineFormulaTable(JSON.parse(JSON.stringify(importFormulaTable(parseDelimited(LEVELS), 'table'))));
  assert.ok(Object.isFrozen(levels) && Object.isFrozen(levels.values));
  assert.equal(tableValue(levels, '12', 'attack'), 41);
  assert.deepEqual(tableRow(levels, '2', 'level'), {'level.hp': 26, 'level.attack': 7, 'level.xpToNext': 250});
  const sheet = defineFormulaSheet({
    inputs: ['level.attack', 'defense'],
    steps: [{id: 'damage', expr: {text: 'max(1, level.attack - defense)'}}],
  });
  assert.equal(evaluateSheet(sheet, {...tableRow(levels, '12', 'level', ['attack']), defense: 10}).value, 31);
  assert.throws(() => tableRow(levels, '12', 'level', ['mana']), /no column mana/);
  const chart = defineFormulaTable(
    importFormulaTable(parseDelimited(CHART), 'matrix', {meta: {note: 'example chart'}}),
  );
  assert.equal(tableValue(chart, 'Water', 'Fire'), 2);
  assert.equal(chart.meta?.note, 'example chart');
  assert.throws(() => tableRow(chart, 'Fire'), /tableRow reads a table/);
  assert.throws(() => tableValue(chart, 'Ice', 'Fire'), /no row Ice/);
  assert.throws(() => tableValue(chart, 'Fire', 'Ice'), /no column Ice/);
  assert.throws(() => tableValue({...chart}, 'Fire', 'Fire'), /defineFormulaTable/);
});

test('formula data: table refusals name the row and column; committed JSON is checked again on load', () => {
  assert.throws(
    () => importFormulaTable(parseDelimited('level,hp\n1,20\n2\n'), 'table'),
    /row 3: 1 cells, the header has 2/,
  );
  assert.throws(
    () => importFormulaTable(parseDelimited('level,hp\n1,lots\n'), 'table'),
    /row 2 column hp: "lots" is not a number/,
  );
  assert.throws(() => importFormulaTable(parseDelimited('level,max\n1,2\n'), 'table'), /not a usable name/); // operator names are reserved
  assert.throws(() => importFormulaTable(parseDelimited('level,hp\n1,2\n1,3\n'), 'table'), /row "1" appears twice/);
  assert.throws(() => importFormulaTable(parseDelimited('level,hp\n'), 'table'), /at least one data row/);
  assert.throws(() => importFormulaTable(parseDelimited('k,v\n__proto__,1\n'), 'table'), /not a usable key/);
  const good = importFormulaTable(parseDelimited(LEVELS), 'table');
  assert.throws(
    () =>
      defineFormulaTable({
        ...good,
        values: [
          [1, 2, 3],
          [1, 2, 3],
        ],
      }),
    /2 value rows for 3 keys/,
  );
  assert.throws(
    () => defineFormulaTable({...good, values: good.values.map(r => r.map(() => NaN))}),
    /not a finite number/,
  );
  assert.throws(() => defineFormulaTable({...good, meta: {source: 5 as never}}), /meta.source must be text/);
  assert.throws(() => defineFormulaTable({...good, kind: 'grid' as never}), /kind must be table or matrix/);
  // review regressions: sparse arrays, accessors, limits, meta and key types
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(
    () => defineFormulaTable({kind: 'table', columns: ['hp'], rows: ['1', '2'], values: [[1], ,] as never}),
    /dense data array/,
  );
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(
    () => defineFormulaTable({kind: 'table', columns: ['hp', , 'atk'] as never, rows: ['1'], values: [[1, 2, 3]]}),
    FormulaError,
  );
  let reads = 0;
  const tricky = Object.defineProperty([] as string[], '0', {
    get: () => (reads++ ? '__proto__' : 'hp'),
    enumerable: true,
  });
  assert.throws(() => defineFormulaTable({kind: 'table', columns: tricky, rows: ['1'], values: [[1]]}), /accessors/);
  assert.throws(
    () => defineFormulaTable(good, {maxRows: undefined, maxColumns: Number.NaN} as never),
    /maxColumns must be an integer/,
  );
  assert.throws(() => parseDelimited('1\n2\n3', ',', {maxRows: 0}), /maxRows must be an integer/);
  assert.throws(
    () => importFormulaTable(parseDelimited(LEVELS), 'table', {meta: {source: 5} as never}),
    /meta.source must be text/,
  );
  assert.throws(
    () => importFormulaTable(parseDelimited(LEVELS), 'table', {meta: {evil: 'x'} as never}),
    /not a known field/,
  );
  assert.throws(() => importFormulaSheet(parseDelimited(SHEET), {meta: {sourceSha256: 'abc'}}), /64 lowercase hex/);
  const t = defineFormulaTable(good);
  assert.throws(() => tableValue(t, 12 as never, 'hp'), /must be text/);
  const long = defineFormulaTable({kind: 'table', columns: ['c'.repeat(60)], rows: ['1'], values: [[1]]});
  assert.throws(() => tableRow(long, '1', 'level'), /longer than a sheet input name/);
  assert.throws(() => importFormulaSheet(['input,a,'] as never), /must be an array/);
  assert.deepEqual(parseDelimited('"a"  ,b'), [['a', 'b']]);
  assert.throws(() => parseDelimited(`"${'x'.repeat(5000)}"`), /longer than 4096/);
});
