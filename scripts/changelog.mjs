#!/usr/bin/env node
// scripts/changelog.mjs: unreleased changelog entries as one file per change, so parallel pull requests never edit
// the same lines of CHANGELOG.md.
//   npm run changelog                 prints the Unreleased section as it will read: the fragments in
//                                     changes/unreleased/ (newest first) above the entries already in CHANGELOG.md
//   npm run changelog -- --check      validates the fragments (lint:changelog; npm run check runs it)
//   npm run changelog -- --fold       at release time: moves every fragment into CHANGELOG.md's Unreleased section,
//                                     newest first, and deletes the fragment files
// A fragment is changes/unreleased/<kebab-name>.md holding exactly one top-level bullet in CHANGELOG.md's style
// (`- **Title.** Text…`, continuation lines indented two spaces). Its order is the time git first saw the file
// (uncommitted fragments count as now), then its name.
import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DIR = join('changes', 'unreleased');
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;
/** Longest fragment, in lines: an entry says what changed and where to read more, not the whole guide. */
export const MAX_LINES = 24;

/** Problems with one fragment's text ([] when valid). */
export function fragmentProblems(name, text) {
  const out = [];
  if (!NAME.test(name)) out.push(`${name}: name it <kebab-case>.md`);
  if (!text.endsWith('\n')) out.push(`${name}: end the file with a newline`);
  const lines = text.replace(/\n+$/, '').split('\n');
  if (!/^- \*\*[^*].*?\*\*/.test(lines[0] ?? ''))
    out.push(`${name}: start with one bullet and a bold title, e.g. "- **What changed.** How it behaves now."`);
  const extra = lines.slice(1).findIndex(l => l !== '' && !l.startsWith('  '));
  if (extra >= 0) out.push(`${name}:${extra + 2}: one entry per file (indent continuation lines two spaces)`);
  if (lines.length > MAX_LINES) out.push(`${name}: ${lines.length} lines; keep an entry to ${MAX_LINES} or fewer`);
  return out;
}

/** When git first saw `file` (seconds), or now for a file git has not committed. */
function addedAt(root, file) {
  try {
    const t = execFileSync('git', ['log', '--diff-filter=A', '--format=%ct', '-1', '--', file], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (t) return Number(t);
  } catch {
    /* not a git checkout: every fragment counts as new */
  }
  return Math.floor(Date.now() / 1000);
}

/** The fragments, newest first: `{name, text, added}`. README.md is the folder's guide, not an entry. */
export function fragments(root = ROOT) {
  const dir = join(root, DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(n => n.endsWith('.md') && n !== 'README.md')
    .map(name => ({name, text: readFileSync(join(dir, name), 'utf8'), added: addedAt(root, join(DIR, name))}))
    .sort((a, b) => b.added - a.added || a.name.localeCompare(b.name));
}

const UNRELEASED = /^## Unreleased\n\n((?:(?!^- |^## ).*\n)*)/m;

/** CHANGELOG.md text with the fragment bullets inserted at the top of Unreleased (after its introduction). */
export function folded(changelog, entries) {
  const m = UNRELEASED.exec(changelog);
  if (!m) throw Error('CHANGELOG.md has no "## Unreleased" section to fold into');
  const at = m.index + m[0].length;
  const bullets = entries.map(e => e.text.replace(/\n+$/, '\n')).join('');
  // An Unreleased section with no entries yet goes straight to the next heading: keep a blank line before it.
  const gap = bullets && changelog.startsWith('## ', at) ? '\n' : '';
  return changelog.slice(0, at) + bullets + gap + changelog.slice(at);
}

/** The Unreleased section as it will read once folded. */
export function preview(changelog, entries) {
  const text = folded(changelog, entries);
  const start = text.indexOf('## Unreleased');
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next < 0 ? undefined : next + 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const entries = fragments();
  const problems = entries.flatMap(e => fragmentProblems(e.name, e.text));
  if (args.includes('--check')) {
    if (problems.length) {
      console.error(`lint:changelog: ${problems.length} problem(s) in ${DIR}/\n  ${problems.join('\n  ')}`);
      process.exitCode = 1;
    } else console.log(`lint:changelog: ${entries.length} unreleased fragment(s) in ${DIR}/, all valid`);
  } else if (problems.length) {
    console.error(`changelog: fix the fragments first\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
  } else if (args.includes('--fold')) {
    const file = join(ROOT, 'CHANGELOG.md');
    writeFileSync(file, folded(readFileSync(file, 'utf8'), entries));
    for (const e of entries) rmSync(join(ROOT, DIR, e.name));
    console.log(`changelog: folded ${entries.length} fragment(s) into CHANGELOG.md's Unreleased section`);
  } else process.stdout.write(preview(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), entries));
}
