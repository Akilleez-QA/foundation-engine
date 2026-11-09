#!/usr/bin/env node
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, normalize, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SRS = 'docs/requirements/requirements.md';
export const MATRIX = 'docs/verification/verification-matrix.md';
export const SDD = 'docs/architecture/architecture.md';
export const CONTROL_DOCS = [
  'docs/plan/software-management-plan.md',
  'docs/plan/compliance-matrix.md',
  SRS,
  SDD,
  'docs/icd/icd-dependencies.md',
  'docs/data/data-dictionary.md',
  'docs/verification/test-plan.md',
  MATRIX,
  'docs/configuration/configuration-management.md',
  'docs/assurance/assurance-record.md',
];
export const DATA_DICTIONARY = 'docs/data/data-dictionary.md';
export const TOOL_SCHEMA = 'schemas/read-only-tools.json';
export const DISCLAIMER = 'This is not a NASA compliance determination or certification.';
const SKIP_DIRS = new Set(['node_modules', '.git', 'TODELETE', 'dist', 'playtest', 'coverage']);
const CREATOR_GAME = new Set(['game', 'GAME.md']);
const REQ_ID = /^REQ-[A-Z0-9]+-\d{3}$/;
const METHOD = /^[TAID](?:,\s*[TAID])*$/;
const STATUS = new Set(['Baselined', 'Proposed', 'Deleted']);

const posix = p => p.split(sep).join('/');

export function markdownFiles(root) {
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(join(root, dir))) {
      if (SKIP_DIRS.has(name)) continue;
      if (!dir && CREATOR_GAME.has(name)) continue;
      const rel = dir ? `${dir}/${name}` : name;
      const st = statSync(join(root, rel));
      if (st.isDirectory()) {
        if (rel === 'perf/runs' || rel === 'perf/cache') continue;
        walk(rel);
      } else if (name.endsWith('.md')) out.push(rel);
    }
  };
  walk('');
  return out.sort();
}

export function tableRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || /^\|[\s:|-]+\|$/.test(trimmed)) continue;
    const cells = trimmed
      .slice(1, trimmed.endsWith('|') ? -1 : undefined)
      .split(/(?<!\\)\|/)
      .map(c => c.trim());
    rows.push(cells);
  }
  return rows;
}

const backticked = cell => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]);
const looksLikePath = token => /^[\w.@-]+(?:\/[\w.@*-]+)+$/.test(token) && /\.[a-z0-9]+$/i.test(token);
const npmScripts = cell => [...cell.matchAll(/npm run ([\w:.-]+)/g)].map(m => m[1]);

function readPackageScripts(root) {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')).scripts ?? {};
}

export function parseRequirements(text) {
  return tableRows(text)
    .filter(cells => REQ_ID.test(cells[0]))
    .map(cells => ({
      id: cells[0],
      cells,
      statement: cells[1] ?? '',
      rationale: cells[2] ?? '',
      derivation: cells[3] ?? '',
      allocated: cells[4] ?? '',
      method: cells[5] ?? '',
      status: cells[6] ?? '',
    }));
}

export function parseMatrix(text) {
  return tableRows(text)
    .filter(cells => REQ_ID.test(cells[0]))
    .map(cells => ({id: cells[0], method: cells[1] ?? '', evidence: cells[2] ?? '', result: cells[3] ?? ''}));
}

export function headingAnchors(text) {
  const anchors = new Set();
  const counts = new Map();
  const body = text.replace(/```[\s\S]*?```/g, '');
  for (const match of body.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1]
      .replace(/`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replace(/ /g, '-');
    const seen = counts.get(slug) ?? 0;
    counts.set(slug, seen + 1);
    anchors.add(seen ? `${slug}-${seen}` : slug);
  }
  for (const match of body.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(match[1]);
  return anchors;
}

export function deadLinks(root, files = markdownFiles(root)) {
  const anchorCache = new Map();
  const anchorsOf = rel => {
    if (!anchorCache.has(rel)) anchorCache.set(rel, headingAnchors(readFileSync(join(root, rel), 'utf8')));
    return anchorCache.get(rel);
  };
  const dead = [];
  const seen = new Set();
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]*`/g, '');
    const fragment = file.startsWith('changes/unreleased/') && !file.endsWith('/README.md');
    const base = fragment ? '' : dirname(file);
    for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('<')) continue;
      let path;
      try {
        path = decodeURI(target.split('#')[0]);
      } catch {
        dead.push({file, target});
        continue;
      }
      const resolved = path ? posix(normalize(path.startsWith('/') ? path.slice(1) : join(base, path))) : file;
      const key = `${file}\0${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (resolved.startsWith('..') || !existsSync(join(root, resolved))) {
        dead.push({file, target});
        continue;
      }
      const anchor = target.includes('#') ? target.slice(target.indexOf('#') + 1) : '';
      if (anchor && resolved.endsWith('.md') && statSync(join(root, resolved)).isFile()) {
        let decoded = anchor;
        try {
          decoded = decodeURIComponent(anchor);
        } catch {}
        if (!anchorsOf(resolved).has(decoded)) dead.push({file, target});
      }
    }
  }
  return dead;
}

export function schemaFieldPaths(schema, prefix = '') {
  const paths = [];
  for (const [name, item] of Object.entries(schema?.properties ?? {})) {
    const path = prefix ? `${prefix}.${name}` : name;
    paths.push(path, ...schemaFieldPaths(item, path));
  }
  return paths;
}

export function checkTrace(root = ROOT) {
  const errors = [];
  const info = {};
  const read = rel => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
  const srs = read(SRS);
  const matrix = read(MATRIX);
  const sdd = read(SDD);
  if (srs === null) errors.push(`${SRS}: missing`);
  if (matrix === null) errors.push(`${MATRIX}: missing`);
  if (sdd === null) errors.push(`${SDD}: missing`);
  const scripts = readPackageScripts(root);
  const requirements = srs ? parseRequirements(srs) : [];
  const rows = matrix ? parseMatrix(matrix) : [];
  const ids = new Set();
  for (const r of requirements) {
    if (ids.has(r.id)) errors.push(`${SRS}: ${r.id} is defined twice`);
    ids.add(r.id);
    if (r.cells.length !== 7) {
      errors.push(`${SRS}: ${r.id} needs 7 cells (ID, requirement, rationale, derivation, allocated, method, status)`);
      continue;
    }
    if (!STATUS.has(r.status)) errors.push(`${SRS}: ${r.id} status must be Baselined, Proposed or Deleted`);
    if (r.status === 'Deleted') continue;
    if (!/\bshall\b/.test(r.statement)) errors.push(`${SRS}: ${r.id} has no "shall" statement`);
    if (!r.rationale) errors.push(`${SRS}: ${r.id} has no rationale`);
    if (!METHOD.test(r.method)) errors.push(`${SRS}: ${r.id} method must be T, A, I or D`);
    if (!/SDD §\d/.test(r.allocated)) errors.push(`${SRS}: ${r.id} is not allocated to an SDD section`);
    const derivation = backticked(r.derivation).filter(looksLikePath);
    if (!derivation.length) errors.push(`${SRS}: ${r.id} derivation names no source path`);
    for (const p of derivation)
      if (!p.includes('*') && !existsSync(join(root, p)))
        errors.push(`${SRS}: ${r.id} derivation path ${p} is missing`);
    if (sdd !== null && !sdd.includes(r.id)) errors.push(`${SDD}: ${r.id} is not allocated to a design component`);
  }
  const traced = new Set();
  const citedTests = new Set();
  for (const row of rows) {
    if (!ids.has(row.id)) {
      errors.push(`${MATRIX}: ${row.id} has no requirement in ${SRS}`);
      continue;
    }
    traced.add(row.id);
    if (!METHOD.test(row.method)) errors.push(`${MATRIX}: ${row.id} method must be T, A, I or D`);
    const paths = backticked(row.evidence)
      .flatMap(t => t.split(/\s+/))
      .filter(looksLikePath);
    for (const p of paths) {
      if (p.includes('*')) continue;
      if (!existsSync(join(root, p))) errors.push(`${MATRIX}: ${row.id} cites missing file ${p}`);
      else if (/\.test\.(?:ts|mjs)$|\.regression\.mjs$/.test(p)) citedTests.add(p);
    }
    const missingScripts = npmScripts(row.evidence).filter(s => !(s in scripts));
    for (const s of missingScripts) errors.push(`${MATRIX}: ${row.id} cites unknown npm script ${s}`);
    const methods = row.method.split(/,\s*/);
    if (methods.includes('T') && !paths.length && !npmScripts(row.evidence).length)
      errors.push(`${MATRIX}: ${row.id} is verified by test but names no test file or npm script`);
    if ((methods.includes('I') || methods.includes('A')) && !row.evidence)
      errors.push(`${MATRIX}: ${row.id} must name what is inspected or analysed`);
    if (!row.result) errors.push(`${MATRIX}: ${row.id} has no last result`);
  }
  for (const r of requirements)
    if (r.status !== 'Deleted' && !traced.has(r.id)) errors.push(`${MATRIX}: ${r.id} has no verification row`);
  for (const rel of CONTROL_DOCS) {
    const text = read(rel);
    if (text === null) {
      errors.push(`${rel}: control document missing`);
      continue;
    }
    for (const field of ['Document ID', 'Version', 'Status', 'Owner', 'Date', 'Applies to', 'Classification'])
      if (!new RegExp(`^\\| ${field} \\|`, 'm').test(text)) errors.push(`${rel}: metadata field "${field}" missing`);
    if (!/^\| Baseline commit \| `?[0-9a-f]{40}`? \|/m.test(text))
      errors.push(`${rel}: metadata needs a 40-hex baseline commit`);
    if (!text.includes(DISCLAIMER)) errors.push(`${rel}: standard disclaimer missing`);
    if (!/^## Change history$/m.test(text)) errors.push(`${rel}: change history missing`);
  }
  const dictionary = read(DATA_DICTIONARY);
  const toolSchema = read(TOOL_SCHEMA);
  if (dictionary !== null && toolSchema !== null)
    for (const tool of JSON.parse(toolSchema).tools ?? [])
      for (const field of [tool.name, ...schemaFieldPaths(tool.inputSchema), ...schemaFieldPaths(tool.outputSchema)])
        if (!dictionary.includes(`\`${field}\``))
          errors.push(`${DATA_DICTIONARY}: ${TOOL_SCHEMA} field ${field} of ${tool.name} is not defined`);
  for (const {file, target} of deadLinks(root)) errors.push(`${file}: dead link ${target}`);
  info.requirements = requirements.filter(r => r.status !== 'Deleted').length;
  info.traced = [...traced].length;
  info.gaps = srs ? tableRows(srs).filter(cells => /^GAP-\d{3}$/.test(cells[0])).length : 0;
  info.citedTests = citedTests.size;
  return {errors, info};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? args[rootIndex + 1] : ROOT;
  const {errors, info} = checkTrace(root);
  if (args.includes('--json')) console.log(JSON.stringify({errors, info}, null, 2));
  else {
    for (const e of errors) console.error(`check-trace: ${e}`);
    console.log(
      `check-trace: ${info.requirements} requirements, ${info.traced} traced, ${info.gaps} untested gaps, ` +
        `${info.citedTests} test files cited, ${errors.length} problems (${relative(process.cwd(), root) || '.'})`,
    );
  }
  process.exitCode = errors.length ? 1 : 0;
}
