import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {check, findClaims, scan, scannedFiles} from './docs-claims.mjs';

/** A manifest's features: lights shipped in #138, the three.js kit not yet. */
const FEATURES = [
  {
    id: 'VIS-02',
    title: 'Point and spot lights',
    shipped: true,
    pr: 138,
    docs: 'docs/guides/scene-look.md',
    evidence: ['@engine exports PointLight'],
  },
  {id: 'VIS-03', title: 'Shadows', shipped: true, pr: 148, evidence: ['@engine exports Shadow']},
  {id: 'VIS-01', title: 'Tone mapping', shipped: true, pr: 124, evidence: ['@engine exports validateSceneOutput']},
  {id: 'POST-01', title: 'Post-processing (bloom)', shipped: false, evidence: ['engine code reads post.mode']},
  {id: 'VIS-09', title: 'Opt-in full three.js kit', shipped: false, pr: 136, evidence: ['@kits/three exists']},
];
const claimsIn = (text, file = 'docs/page.md') => findClaims(text).map(c => ({file, ...c}));

test('a stale claim about a shipped feature fails, naming the feature and its PR', () => {
  const claims = claimsIn('# Look\n\nThe engine has no local lights yet, so bake them.\n');
  assert.deepEqual(
    claims.map(c => [c.id, c.line]),
    [['VIS-02', 3]],
  );
  const {errors} = check(claims, FEATURES);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^docs\/page\.md:3: "no local lights"/);
  assert.match(errors[0], /Point and spot lights shipped in PR #138/);
  assert.match(errors[0], /@engine exports PointLight; see docs\/guides\/scene-look\.md/);
});

test('a correct "not yet" about a feature that has not shipped passes', () => {
  const claims = claimsIn('No `@kits/three` kit exists yet, and there is no bloom.\n');
  assert.deepEqual(claims.map(c => c.id).sort(), ['POST-01', 'VIS-09']);
  assert.deepEqual(check(claims, FEATURES).errors, []);
});

test('a list after a lead claims each item, across wrapped lines', () => {
  const text =
    'Report the result. Not available yet in the engine (say so): local lights,\ncast shadows, tone mapping and bloom.\n';
  const claims = claimsIn(text);
  assert.deepEqual(
    claims.map(c => [c.id, c.line]),
    [
      ['POST-01', 2],
      ['VIS-01', 2],
      ['VIS-02', 1],
      ['VIS-03', 2],
    ].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])),
  );
  assert.equal(check(claims, FEATURES).errors.length, 3);
});

test('a table under a "not here yet" heading claims each first cell; other tables do not', () => {
  const missing = '## What is not here yet\n\n| Missing | Today |\n|---|---|\n| Cast shadows | bake them |\n';
  assert.deepEqual(
    claimsIn(missing).map(c => [c.id, c.line]),
    [['VIS-03', 5]],
  );
  const other = '## Shadows\n\n| Knob | Value |\n|---|---|\n| Cast shadows | on |\n';
  assert.deepEqual(claimsIn(other), []);
});

test('limits of a shipped feature and fenced code are not claims', () => {
  const text = [
    'A scene without `sceneShadows()` is unchanged; a light still shines without a shadow when no slot is free.',
    'Models with no KTX2 image download nothing. No flipbook draws from `ctx.random()`.',
    '```md',
    'The engine has no local lights yet.',
    '```',
  ].join('\n');
  assert.deepEqual(findClaims(text), []);
});

test('an escape with a reason allows one deliberate historical claim', () => {
  const text = '<!-- docs-claims: allow VIS-02 before PR #138 -->\nUntil 0.3.0 the engine had no local lights yet.\n';
  assert.deepEqual(findClaims(text), []);
  assert.equal(findClaims('<!-- docs-claims: allow VIS-02 -->\nno local lights yet\n').length, 1, 'needs a reason');
});

test('the baseline lets a listed file keep its known claims, and a stale entry only warns', () => {
  const claims = claimsIn('The engine has no local lights yet.\n', 'docs/recipes/look.md');
  const baseline = [{file: 'docs/recipes/look.md', id: 'VIS-02', count: 1, reason: 'rewritten elsewhere'}];
  assert.deepEqual(check(claims, FEATURES, baseline).errors, []);
  const fixed = check([], FEATURES, baseline);
  assert.deepEqual(fixed.errors, []);
  assert.equal(fixed.warnings.length, 1);
  assert.deepEqual(fixed.remaining, []);
  const grown = claimsIn('No local lights yet.\n\nStill no point lights yet.\n', 'docs/recipes/look.md');
  assert.equal(check(grown, FEATURES, baseline).errors.length, 1, 'a count above the baseline fails');
});

test('dated verification and release records are exempt; skills, agents and template READMEs are scanned', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-claims-'));
  const page = (rel, text = 'The engine has no local lights yet.\n') => {
    mkdirSync(join(root, rel, '..'), {recursive: true});
    writeFileSync(join(root, rel), text);
  };
  page('docs/verification/lights-20261003.md');
  page('docs/releases/candidate-7c26db7/README.md');
  page('docs/recipes/look.md');
  page('.claude/skills/look/SKILL.md');
  page('.claude/agents/builder.md');
  page('templates/showcase/README.md');
  page('templates/showcase/game/notes.md');
  page('AGENTS.md');
  assert.deepEqual(scannedFiles(root), [
    '.claude/agents/builder.md',
    '.claude/skills/look/SKILL.md',
    'AGENTS.md',
    'docs/recipes/look.md',
    'templates/showcase/README.md',
  ]);
  assert.equal(scan(root).length, 5);
});
