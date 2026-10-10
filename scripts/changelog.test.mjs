// changelog: one fragment file per unreleased change, validated, previewed newest first and folded at release.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DIR, folded, fragmentProblems, fragments, MAX_LINES, preview} from './changelog.mjs';

const LOG = `# Changelog

Intro.

## Unreleased

Everything merged after the last candidate.

- **Older entry.** Already folded.

## 0.2.0 — 2026-10-03

- **Released.** Text.
`;

test('changelog: a valid fragment is one bold-titled bullet with indented continuation lines', () => {
  assert.deepEqual(fragmentProblems('blob-shadows.md', '- **Blob shadows.** One draw.\n  Second line.\n'), []);
  assert.deepEqual(fragmentProblems('a.md', '- **A.** x\n\n  Paragraph two.\n'), []);
});

test('changelog: names, missing titles, two entries, a missing newline and long entries are refused', () => {
  assert.match(fragmentProblems('Blob Shadows.md', '- **A.** x\n').join(), /kebab-case/);
  assert.match(fragmentProblems('a.md', 'Some text\n').join(), /bold title/);
  assert.match(fragmentProblems('a.md', '- **A.** x\n- **B.** y\n').join(), /a\.md:2: one entry per file/);
  assert.match(fragmentProblems('a.md', '- **A.** x').join(), /newline/);
  const long = `- **A.** x\n${'  more\n'.repeat(MAX_LINES)}`;
  assert.match(fragmentProblems('a.md', long).join(), /keep an entry to/);
});

test('changelog: folding puts fragments at the top of Unreleased, after its introduction, in the given order', () => {
  const out = folded(LOG, [{text: '- **New B.** b\n'}, {text: '- **New A.** a\n'}]);
  assert.match(out, /after the last candidate\.\n\n- \*\*New B\.\*\* b\n- \*\*New A\.\*\* a\n- \*\*Older entry\.\*\*/);
  assert.match(out, /## 0\.2\.0 — 2026-10-03\n\n- \*\*Released\.\*\*/);
  assert.throws(() => folded('# Changelog\n', []), /no "## Unreleased"/);
  // An empty Unreleased section keeps a blank line before the next release heading.
  assert.match(folded('## Unreleased\n\n## 0.2.0\n', [{text: '- **A.** a\n'}]), /- \*\*A\.\*\* a\n\n## 0\.2\.0/);
});

test('changelog: the preview is only the Unreleased section', () => {
  const text = preview(LOG, [{text: '- **New.** n\n'}]);
  assert.match(text, /^## Unreleased\n/);
  assert.match(text, /- \*\*New\.\*\* n\n- \*\*Older entry\.\*\*/);
  assert.doesNotMatch(text, /0\.2\.0/);
});

test('changelog: fragments are read from changes/unreleased, README excluded, newest first then by name', () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-changelog-'));
  try {
    mkdirSync(join(root, DIR), {recursive: true});
    writeFileSync(join(root, DIR, 'README.md'), '# Guide\n');
    writeFileSync(join(root, DIR, 'b-change.md'), '- **B.** b\n');
    writeFileSync(join(root, DIR, 'a-change.md'), '- **A.** a\n');
    // No git history here: both count as new, so the order falls back to the name.
    assert.deepEqual(
      fragments(root).map(f => f.name),
      ['a-change.md', 'b-change.md'],
    );
    assert.equal(readdirSync(join(root, DIR)).length, 3);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
