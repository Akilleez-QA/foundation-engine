import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {
  CONTROL_DOCS,
  DISCLAIMER,
  MATRIX,
  ROOT,
  SDD,
  SRS,
  checkTrace,
  deadLinks,
  parseMatrix,
  parseRequirements,
} from './check-trace.mjs';
import {changelogSection, parseArgs, schemaFields, tapTotals} from './reports.mjs';

const HEADER = [
  '| Field | Value |',
  '|---|---|',
  '| Document ID | X-1 |',
  '| Version | 1.0 |',
  '| Status | Baselined |',
  '| Owner | someone |',
  '| Date | 2026-11-08 |',
  `| Baseline commit | \`${'a'.repeat(40)}\` |`,
  '| Applies to | fixture |',
  '| Classification | Class E analog |',
  '',
  `> ${DISCLAIMER}`,
  '',
].join('\n');

const TRACE = '## 2. Requirement to verification trace\n\n| Requirement | Method | Verification | Last result |\n|---|---|---|---|';
const HISTORY = '## 4. Earlier evidence (historical)\n\n| Requirement | Method | Test file or command | Result |\n|---|---|---|---|';

const REQ =
  '| REQ-X-001 | The tool shall work. | Because. | `src/a.ts` | SDD §1 | T | Baselined |\n' +
  '| REQ-X-002 | The tool shall stop. | Because. | `src/a.ts` | SDD §1 | I | Baselined |';

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-trace-'));
  const files = {
    'package.json': JSON.stringify({scripts: {'lint:x': 'true'}}),
    'src/a.ts': 'export {};\n',
    'src/a.test.ts': 'export {};\n',
    [SRS]: `${HEADER}\n${REQ}\n\n## Change history\n`,
    [MATRIX]: `${HEADER}\n${TRACE}\n| REQ-X-001 | T | \`src/a.test.ts\` | Pass |\n| REQ-X-002 | I | Inspect \`src/a.ts\` | Inspected |\n\n## Change history\n`,
    [SDD]: `${HEADER}\nREQ-X-001 and REQ-X-002 live here. [srs](../requirements/requirements.md)\n\n## Change history\n`,
    ...overrides,
  };
  for (const doc of CONTROL_DOCS) if (!(doc in files)) files[doc] = `${HEADER}\n## Change history\n`;
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), text);
  }
  return root;
}

function errorsFor(overrides) {
  const root = fixture(overrides);
  try {
    return checkTrace(root).errors;
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

test('check-trace: the repository control documents trace, carry headers and have no dead links', () => {
  const {errors, info} = checkTrace();
  assert.deepEqual(errors, []);
  assert.equal(info.traced, info.requirements);
  assert.ok(info.requirements > 0);
});

test('check-trace: a complete fixture passes', () => {
  assert.deepEqual(errorsFor({}), []);
});

test('check-trace: a requirement without a verification row fails', () => {
  const errors = errorsFor({
    [MATRIX]: `${HEADER}\n${TRACE}\n| REQ-X-001 | T | \`src/a.test.ts\` | Pass |\n\n## Change history\n`,
  });
  assert.ok(errors.some(e => e.includes('REQ-X-002 has no verification row')));
});

test('check-trace: a historical row does not satisfy a requirement that lost its current verification row', () => {
  const errors = errorsFor({
    [MATRIX]: `${HEADER}\n${TRACE}\n| REQ-X-001 | T | \`src/a.test.ts\` | Pass |\n\n${HISTORY}\n| REQ-X-002 | I | Inspect \`src/a.ts\` | Inspected |\n\n## Change history\n`,
  });
  assert.ok(errors.some(e => e.includes('REQ-X-002 has no verification row')));
});

test('check-trace: historical rows are still checked for unknown requirements and missing files', () => {
  const errors = errorsFor({
    [MATRIX]: `${HEADER}\n${TRACE}\n| REQ-X-001 | T | \`src/a.test.ts\` | Pass |\n| REQ-X-002 | I | Inspect \`src/a.ts\` | Inspected |\n\n${HISTORY}\n| REQ-X-009 | T | \`src/a.test.ts\` | Pass |\n| REQ-X-001 | T | \`src/gone.test.ts\` | Pass |\n\n## Change history\n`,
  });
  assert.ok(errors.some(e => e.includes('REQ-X-009 has no requirement')));
  assert.ok(errors.some(e => e.includes('cites missing file src/gone.test.ts')));
});

test('check-trace: a matrix without its current trace section fails', () => {
  const errors = errorsFor({
    [MATRIX]: `${HEADER}\n${HISTORY}\n| REQ-X-001 | T | \`src/a.test.ts\` | Pass |\n| REQ-X-002 | I | Inspect \`src/a.ts\` | Inspected |\n\n## Change history\n`,
  });
  assert.ok(errors.some(e => e.includes('has no "Requirement to verification trace" section')));
  assert.ok(errors.some(e => e.includes('REQ-X-001 has no verification row')));
  assert.ok(errors.some(e => e.includes('REQ-X-002 has no verification row')));
});

test('check-trace: removing the current REQ-BOOT-001 row from the repository matrix leaves it untraced', () => {
  const text = readFileSync(join(ROOT, MATRIX), 'utf8');
  const removed = text
    .split('\n')
    .filter(line => !/^\| REQ-BOOT-001 \| T \| `src\/core\/app\.test\.ts`/.test(line))
    .join('\n');
  assert.notEqual(removed, text);
  const current = rows => new Set(rows.filter(r => r.current).map(r => r.id));
  assert.ok(current(parseMatrix(text)).has('REQ-BOOT-001'));
  assert.ok(!current(parseMatrix(removed)).has('REQ-BOOT-001'));
  assert.ok(parseMatrix(removed).some(r => r.id === 'REQ-BOOT-001' && !r.current));
});

test('check-trace: a matrix row citing a missing test or npm script fails', () => {
  const errors = errorsFor({
    [MATRIX]: `${HEADER}\n${TRACE}\n| REQ-X-001 | T | \`src/gone.test.ts\`; \`npm run lint:none\` | Pass |\n| REQ-X-002 | I | Inspect \`src/a.ts\` | Inspected |\n\n## Change history\n`,
  });
  assert.ok(errors.some(e => e.includes('cites missing file src/gone.test.ts')));
  assert.ok(errors.some(e => e.includes('unknown npm script lint:none')));
});

test('check-trace: a test-verified row with no test, and a row with no requirement, fail', () => {
  const errors = errorsFor({
    [MATRIX]: `${HEADER}\n${TRACE}\n| REQ-X-001 | T | by hand | Pass |\n| REQ-X-002 | I | Inspect \`src/a.ts\` | Inspected |\n| REQ-X-009 | T | \`src/a.test.ts\` | Pass |\n\n## Change history\n`,
  });
  assert.ok(errors.some(e => e.includes('REQ-X-001 is verified by test but names no test file')));
  assert.ok(errors.some(e => e.includes('REQ-X-009 has no requirement')));
});

test('check-trace: missing shall, method, allocation, derivation path and design trace are reported', () => {
  const errors = errorsFor({
    [SRS]: `${HEADER}\n| REQ-X-001 | The tool works. | Because. | \`src/missing.ts\` | design | Q | Baselined |\n| REQ-X-002 | The tool shall stop. | Because. | \`src/a.ts\` | SDD §1 | I | Baselined |\n\n## Change history\n`,
    [SDD]: `${HEADER}\nREQ-X-002 only.\n\n## Change history\n`,
  });
  for (const expected of [
    'REQ-X-001 has no "shall" statement',
    'REQ-X-001 method must be T, A, I or D',
    'REQ-X-001 is not allocated to an SDD section',
    'derivation path src/missing.ts is missing',
    `${SDD}: REQ-X-001 is not allocated to a design component`,
  ])
    assert.ok(
      errors.some(e => e.includes(expected)),
      expected,
    );
});

test('check-trace: a control document without its header, disclaimer or change history fails', () => {
  const errors = errorsFor({[CONTROL_DOCS[0]]: '# Plan\n'});
  assert.ok(errors.some(e => e.includes(`${CONTROL_DOCS[0]}: metadata field "Document ID" missing`)));
  assert.ok(errors.some(e => e.includes(`${CONTROL_DOCS[0]}: metadata needs a 40-hex baseline commit`)));
  assert.ok(errors.some(e => e.includes(`${CONTROL_DOCS[0]}: standard disclaimer missing`)));
  assert.ok(errors.some(e => e.includes(`${CONTROL_DOCS[0]}: change history missing`)));
});

test('check-trace: a tool schema field missing from the data dictionary fails', () => {
  const errors = errorsFor({
    'schemas/read-only-tools.json': JSON.stringify({
      tools: [{name: 'probe', inputSchema: {type: 'object', properties: {depth: {type: 'integer'}}}, outputSchema: {}}],
    }),
    'docs/data/data-dictionary.md': `${HEADER}\n\`probe\`\n\n## Change history\n`,
  });
  assert.ok(errors.some(e => e.includes('field depth of probe is not defined')));
});

test('dead links: targets and heading anchors resolve, fragments read from the root, code and URLs are ignored', () => {
  const root = fixture({
    'docs/a.md':
      '[ok](b.md) [anchor](b.md#x-y) [bad](b.md#nope) [gone](c.md) [self](#a) [web](https://example.com) `[code](nope.md)`\n# A\n',
    'docs/b.md': '# B\n\n## X, y\n',
    'changes/unreleased/x.md': '- **X.** See [b](docs/b.md).\n',
    'changes/unreleased/README.md': '[changelog](../../package.json)\n',
  });
  try {
    assert.deepEqual(
      deadLinks(root).map(d => `${d.file} ${d.target}`),
      ['docs/a.md b.md#nope', 'docs/a.md c.md'],
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("dead links: a game started with new-game (root GAME.md and game/) is the creator's and is not link-checked", () => {
  const root = fixture({
    'docs/a.md': '# A\n',
    'templates/blank/GAME.md': '[pure](../../docs/a.md)\n',
    'GAME.md': '[pure](../../docs/a.md)\n',
    'game/notes.md': '[gone](nope.md)\n',
  });
  try {
    assert.deepEqual(deadLinks(root), []);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('parseRequirements reads seven-cell rows and ignores other tables', () => {
  const rows = parseRequirements(`| ID | x |\n|---|---|\n${REQ}\n| GAP-001 | gap | src | why |\n`);
  assert.deepEqual(
    rows.map(r => [r.id, r.method, r.status]),
    [
      ['REQ-X-001', 'T', 'Baselined'],
      ['REQ-X-002', 'I', 'Baselined'],
    ],
  );
});

test('reports: TAP totals, changelog sections, schema fields and arguments', () => {
  const totals = tapTotals('not ok 3 - broken\n# tests 5\n# pass 4\n# fail 1\n# duration_ms 12.5\n');
  assert.deepEqual(totals, {tests: 5, pass: 4, fail: 1, duration_ms: 12.5, failures: ['broken']});
  assert.deepEqual(changelogSection('# C\n## Unreleased\nx\n## 0.2.0 — 2026-10-03\na\nb\n## 0.1.0\n', '0.2.0'), {
    heading: '0.2.0 — 2026-10-03',
    lines: 3,
  });
  assert.deepEqual(
    schemaFields({
      type: 'object',
      required: ['a'],
      properties: {a: {type: 'integer', minimum: 0}, b: {type: 'object', properties: {c: {enum: ['x']}}}},
    }),
    [
      {path: 'a', type: 'integer', required: true, range: '>= 0'},
      {path: 'b', type: 'object', required: false, range: ''},
      {path: 'b.c', type: 'string', required: false, range: 'one of `x`'},
    ],
  );
  assert.deepEqual(parseArgs(['str', '--label', 'l', '--browser', 'a=b', '--trace', '--no-gh']), {
    command: 'str',
    browser: ['a=b'],
    label: 'l',
    trace: true,
    noGh: true,
  });
  assert.throws(() => parseArgs(['vdd', '--tag']), /needs a value/);
});
