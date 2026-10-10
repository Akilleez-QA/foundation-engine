#!/usr/bin/env node
// scripts/lint/docs-claims.mjs (`npm run lint:docs-claims`): docs must not say a shipped feature is missing.
//
// A fresh agent believes the page it reads first. When many PRs land at once, a skill or recipe can still say
// "no local lights yet" after the lights merged, and the agent then tells the creator something real is impossible.
// This lint makes that drift a failure:
//   1. docs/capabilities.json and docs/capabilities.md must match what `npm run capabilities` generates from the code.
//   2. Every scanned page is searched for "missing feature" claims with the explicit CLAIMS table below (phrase ->
//      feature ID; no broad language model). A claim fails when the manifest says that feature has shipped. A claim
//      about a feature that has not shipped ("no @kits/three kit exists yet") passes.
//
// Scanned: AGENTS.md, CLAUDE.md, README.md, docs/**/*.md, .claude/skills/**/*.md, .claude/agents/*.md and
// templates/*/README.md. Not scanned: dated records that describe a past revision (docs/verification/,
// docs/releases/) and fenced code blocks. CHANGELOG.md is history and is not scanned.
//
// A deliberate historical statement on a scanned page carries an escape with a reason, on its line or the line above:
//   <!-- docs-claims: allow VIS-03 before PR #148 -->
// lint-baseline/docs-claims.json lists known hits in files another change is rewriting: an entry lets that file keep
// that many claims about that feature. Entries only fall (`--lower` drops what no longer matches); a stale entry is
// reported as a warning.
//
//   node scripts/lint/docs-claims.mjs           check
//   node scripts/lint/docs-claims.mjs --list    print every claim found, shipped or not
//   node scripts/lint/docs-claims.mjs --lower   rewrite the baseline without entries that no longer match
import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {staleFiles, render, JSON_PATH} from '../capabilities.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const BASELINE = 'lint-baseline/docs-claims.json';
export const SCANNED = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'docs', '.claude/skills', '.claude/agents', 'templates'];
/** Dated records describe one past revision; they keep what was true then. */
export const EXEMPT = [/^docs\/verification\//, /^docs\/releases\//];

// Shared fragments. `NOT_YET` is "not … yet / missing / unimplemented" in the forms the docs use.
const NOT_YET =
  "(?:(?:is|are|does|do|has|have)\\s+not\\s+(?:here|available|supported|implemented|exist|on\\s+main|shipped)(?:\\s+yet)?|(?:isn't|aren't|doesn't|don't)\\s+(?:here|available|supported|exist|on\\s+main)(?:\\s+yet)?|not\\s+(?:available|supported|implemented|on\\s+main)\\s+yet|(?:is|are)\\s+unimplemented|(?:is|are)\\s+missing)";
const re = s => new RegExp(s, 'i');

/**
 * Claim phrases, each naming the feature ID it claims is missing. `patterns` match a sentence on their own; `item`
 * matches an item of a list that follows a lead in LIST_LEADS, or the first cell of a table row under a "not here yet"
 * heading. Keep each pattern narrow: it must read as "this feature does not exist", not as a limit of one that does.
 * Add a row when a stale claim slips through review.
 * @type {readonly {id: string, patterns: readonly RegExp[], item?: RegExp}[]}
 */
export const CLAIMS = [
  {
    id: 'VIS-01',
    patterns: [re('\\bno tone[ -]?mapping\\b'), re(`\\btone[ -]?mapping\\b[^.]{0,30}${NOT_YET}`)],
    item: re('\\btone[ -]?mapping\\b'),
  },
  {
    id: 'VIS-02',
    patterns: [
      re('\\bno (?:real |dynamic |runtime )?(?:local|point|spot|point or spot|point and spot) lights?\\b'),
      re(`\\b(?:local|point|spot) lights?\\b[^.]{0,30}${NOT_YET}`),
    ],
    item: re('\\b(?:local|point|spot)\\b[^,;|]{0,20}\\blights?\\b'),
  },
  {
    id: 'VIS-03',
    patterns: [
      re('\\b(?:has|have) no (?:cast |real |dynamic )?shadows\\b'),
      re('\\bno cast shadows\\b'),
      re(`\\b(?:cast )?shadows\\b[^.]{0,30}${NOT_YET}`),
    ],
    item: re('\\b(?:cast |real |dynamic )?shadows\\b'),
  },
  {
    id: 'VIS-04',
    patterns: [
      re('\\bno material on (?:a )?`?Mesh`?'),
      re(`\\bmaterial on (?:a )?\`?Mesh\`?[^.]{0,30}${NOT_YET}`),
      re(`\\b(?:toon|flat|matte) shading\\b[^.]{0,30}${NOT_YET}`),
    ],
    item: re('\\bmaterial on (?:a )?`?Mesh`?'),
  },
  {
    id: 'VIS-05',
    patterns: [re('\\bno (?:gradient |procedural )sky(?:box)?\\b'), re(`\\bgradient sky\\b[^.]{0,30}${NOT_YET}`)],
    item: re('\\b(?:gradient|procedural)\\b[^,;|]{0,20}\\bsky\\b'),
  },
  {
    id: 'VIS-06',
    patterns: [
      re("\\bcan(?:'t|not) instance\\b"),
      re('\\bno (?:author(?:-facing)? )?instancing\\b'),
      re('\\bno scatter\\b'),
      re(`\\b(?:scatter|instancing)\\b\`?[^.]{0,20}${NOT_YET}`),
    ],
    item: re('\\b(?:instancing|instanced scatter)\\b'),
  },
  {
    id: 'VIS-09',
    patterns: [re('\\bno `?@kits/three`? kit\\b'), re(`@kits/three\`?[^.]{0,30}${NOT_YET}`)],
    item: re('@kits/three'),
  },
  {
    id: 'POST-01',
    patterns: [
      re('\\bno bloom\\b'),
      re(`\\bbloom\\b[^.]{0,30}${NOT_YET}`),
      re('post\\.mode`?[^.]{0,60}\\b(?:unimplemented|not implemented|has no consumer|does nothing|changes nothing)'),
      // "Bloom needs three.js": sending a game to @kits/three or an EffectComposer for bloom says the engine has none.
      re(
        '\\bbloom\\b[^.]{0,40}\\b(?:needs|requires|means|takes|through|via)\\b[^.]{0,20}(?:@kits/three|three\\.js|an? EffectComposer)',
      ),
      re('\\bbloom or (?:another|other) EffectComposer pass'),
      re('\\bEffectComposer (?:and|with) bloom\\b'),
      re("\\b(?:cannot|can't) (?:say|express|do)\\b[^.]{0,40}\\bbloom\\b"),
    ],
    item: re('\\bbloom\\b|\\bpost-processing\\b'),
  },
  {
    id: 'FX-01',
    patterns: [
      re('\\bno particle (?:system|emitters?)\\b'),
      re('\\bno particles yet\\b'),
      re(`\\bparticle (?:emitters|system)\\b[^.]{0,20}${NOT_YET}`),
    ],
    item: re('\\bparticles?\\b'),
  },
  {
    id: 'FX-01a',
    patterns: [re('\\bno flipbook (?:support|particles|animation)\\b'), re(`\\bflipbooks?\\b[^.]{0,30}${NOT_YET}`)],
    item: re('\\bflipbooks?\\b'),
  },
  {
    id: 'KTX2',
    patterns: [
      re('\\bno KTX2 (?:support|loader|textures)\\b'),
      re(`\\bKTX2\\b[^.]{0,30}${NOT_YET}`),
      re('\\bKTX2\\b[^.]{0,30}\\bunsupported\\b'),
    ],
    item: re('\\bKTX2\\b'),
  },
  {
    id: 'MP-01',
    patterns: [re('\\bno (?:newcomer-runnable )?(?:shared|multiplayer) session\\b')],
  },
  {
    id: 'PIPELINE-01',
    patterns: [
      re('\\bworker render pipelining\\b[^.]{0,60}\\b(?:not built|deferred)\\b'),
      re('\\bdefer(?:red|s)? worker render pipelining\\b'),
    ],
    item: re('\\bworker render pipelining\\b'),
  },
  {
    id: 'WEBGPU',
    patterns: [re('\\bno WebGPU backend\\b'), re(`\\bWebGPU\\b[^.]{0,40}${NOT_YET}`)],
    item: re('\\bWebGPU\\b'),
  },
  {
    id: 'PHYSICS',
    patterns: [re('\\bno (?:rigid-body )?physics engine\\b')],
    item: re('\\brigid-body physics\\b'),
  },
];

/** A heading over a table of missing features. */
export const SECTION = /\b(?:not here(?: yet)?|what is missing|not available yet|missing features)\b/i;
/** Leads whose following list (to the end of the sentence) names missing features, item by item. */
export const LIST_LEADS = [
  /\bnot (?:available|here|supported) yet\b[^.:]{0,80}:/gi,
  /\b(?:has|have) no\b(?=[^.]{0,120}\byet\b)/gi,
  /\b(?:does|do) not (?:yet )?have\b(?=[^.]{0,120}\byet\b)/gi,
  /\bno\b(?=[^.]{0,120}\b(?:yet|exist|exists)\b)/gi,
];

const ESCAPE = /<!--\s*docs-claims:\s*allow\s+([A-Za-z0-9-]+)\s+\S[^>]*-->/g;
const posix = p => p.split(sep).join('/');

/** Every scanned Markdown file, as root-relative POSIX paths. */
export function scannedFiles(root = ROOT) {
  const out = [];
  const walk = rel => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isFile()) {
      if (rel.endsWith('.md')) out.push(rel);
      return;
    }
    for (const e of readdirSync(abs, {withFileTypes: true})) {
      if (e.name === 'node_modules') continue;
      const child = posix(join(rel, e.name));
      // Under templates/ only each template's own README is a doc an agent reads.
      if (rel === 'templates') {
        if (e.isDirectory() && existsSync(join(abs, e.name, 'README.md'))) out.push(`${child}/README.md`);
        continue;
      }
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.md')) out.push(child);
    }
  };
  for (const s of SCANNED) walk(s);
  return [...new Set(out)].filter(f => !EXEMPT.some(r => r.test(f))).sort();
}

/** Markdown blocks outside fenced code: {kind: 'heading' | 'row' | 'text', text, lines, starts}: a paragraph's lines
 * are joined with spaces; `starts` holds each line's offset in `text` and `lines` its 1-based number. */
export function blocks(text) {
  const out = [];
  let fenced = false;
  let para = null;
  const end = () => {
    if (para) out.push(para);
    para = null;
  };
  for (const [i, line] of text.split('\n').entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      end();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (!line.trim()) end();
    else if (/^\s*#/.test(line)) {
      end();
      out.push({kind: 'heading', text: line, lines: [i + 1], starts: [0]});
    } else if (/^\s*\|/.test(line)) {
      end();
      out.push({kind: 'row', text: line, lines: [i + 1], starts: [0]});
    } else {
      // A list item starts its own block; its wrapped lines continue it.
      if (/^\s*(?:[-*+]|\d+\.)\s/.test(line)) end();
      para ??= {kind: 'text', text: '', lines: [], starts: []};
      if (para.text) para.text += ' ';
      para.starts.push(para.text.length);
      para.text += line.trim();
      para.lines.push(i + 1);
    }
  }
  end();
  return out;
}

/** The 1-based line of an offset into a block's joined text. */
function lineAt(block, offset) {
  let line = block.lines[0];
  for (const [k, start] of block.starts.entries()) if (offset >= start) line = block.lines[k];
  return line;
}

/** The claims in one page's text: {line, id, text}. Fenced code and escaped blocks are skipped. */
export function findClaims(text, claims = CLAIMS) {
  const all = text.split('\n');
  const out = [];
  let missingSection = false;
  for (const block of blocks(text)) {
    if (block.kind === 'heading') {
      missingSection = SECTION.test(block.text);
      continue;
    }
    const around = [all[block.lines[0] - 2] ?? '', ...block.lines.map(n => all[n - 1])].join('\n');
    const allowed = new Set([...around.matchAll(ESCAPE)].map(m => m[1].toUpperCase()));
    const found = new Map();
    const add = (id, index, hit) => {
      if (!allowed.has(id.toUpperCase()) && !found.has(id)) found.set(id, {index, text: hit});
    };
    for (const {id, patterns} of claims)
      for (const p of patterns) {
        const m = block.text.match(p);
        if (m) add(id, m.index ?? 0, m[0]);
      }
    // A list after a lead ("not available yet: A, B and C"; "has no A, B or C yet") claims each item.
    const spans = [];
    if (block.kind === 'text')
      for (const lead of LIST_LEADS)
        for (const m of block.text.matchAll(lead)) {
          const from = m.index ?? 0;
          const stop = block.text.slice(from + m[0].length).search(/\.(\s|$)/);
          spans.push([from, stop < 0 ? block.text.length : from + m[0].length + stop]);
        }
    // A table row under a "not here yet" heading claims its first cell.
    if (block.kind === 'row' && missingSection && !/^\s*\|\s*:?-/.test(block.text)) {
      const from = block.text.indexOf('|') + 1;
      spans.push([from, block.text.indexOf('|', from)]);
    }
    for (const [from, to] of spans) {
      const span = block.text.slice(from, to);
      for (const {id, item} of claims) {
        const m = item && span.match(item);
        if (m) add(id, from + (m.index ?? 0), m[0]);
      }
    }
    for (const [id, {index, text: hit}] of found) out.push({line: lineAt(block, index), id, text: hit});
  }
  return out.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
}

/** Every claim in the scanned files. */
export function scan(root = ROOT, claims = CLAIMS) {
  const out = [];
  for (const file of scannedFiles(root))
    for (const c of findClaims(readFileSync(join(root, file), 'utf8'), claims)) out.push({file, ...c});
  return out;
}

/** Why a stale claim fails, naming what shipped and where. */
export function message(claim, feature) {
  const where = feature.pr ? ` in PR #${feature.pr}` : '';
  const docs = feature.docs ? `; see ${feature.docs}` : '';
  return (
    `${claim.file}:${claim.line}: "${claim.text}" says ${feature.id} is missing, but ${feature.title} shipped${where} ` +
    `(${feature.evidence.join(', ')}${docs}). Fix the claim, or mark a deliberate historical statement ` +
    `<!-- docs-claims: allow ${feature.id} <reason> -->.`
  );
}

/**
 * Check claims against a manifest's features and a baseline ([{file, id, count, reason}]).
 * Returns {errors, warnings, remaining} where `remaining` is the baseline without entries that no longer match.
 */
export function check(claims, features, baseline = []) {
  const byId = new Map(features.map(f => [f.id, f]));
  const errors = [];
  const warnings = [];
  for (const c of claims) if (!byId.has(c.id)) errors.push(`${c.file}:${c.line}: claim names unknown feature ${c.id}`);
  const stale = claims.filter(c => byId.get(c.id)?.shipped);
  const groups = new Map();
  for (const c of stale) {
    const key = `${c.file}\0${c.id}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const remaining = [];
  for (const entry of baseline) {
    const found = groups.get(`${entry.file}\0${entry.id}`)?.length ?? 0;
    if (found < entry.count)
      warnings.push(
        `warning: ${BASELINE}: ${entry.file} has ${found} ${entry.id} claim(s), baseline allows ${entry.count}; ` +
          'run node scripts/lint/docs-claims.mjs --lower',
      );
    if (found > 0) remaining.push({...entry, count: Math.min(found, entry.count)});
  }
  for (const [key, list] of groups) {
    const [file, id] = key.split('\0');
    const allowed = baseline.find(b => b.file === file && b.id === id)?.count ?? 0;
    for (const c of list.slice(allowed)) errors.push(message(c, byId.get(id)));
  }
  return {errors, warnings, remaining};
}

const readBaselineFile = root => {
  const p = join(root, BASELINE);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {entries: []};
};
const readBaseline = root => readBaselineFile(root).entries;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const {manifest} = await render(ROOT);
  const claims = scan(ROOT);
  if (process.argv.includes('--list')) {
    const shipped = new Set(manifest.features.filter(f => f.shipped).map(f => f.id));
    for (const c of claims)
      console.log(`${shipped.has(c.id) ? 'STALE  ' : 'not yet'} ${c.id.padEnd(8)} ${c.file}:${c.line}: ${c.text}`);
    process.exit(0);
  }
  const baseline = readBaseline(ROOT);
  const {errors, warnings, remaining} = check(claims, manifest.features, baseline);
  if (process.argv.includes('--lower')) {
    writeFileSync(
      join(ROOT, BASELINE),
      `${JSON.stringify({...readBaselineFile(ROOT), entries: remaining}, null, 2)}\n`,
    );
    console.log(`docs-claims: baseline lowered to ${remaining.length} entr${remaining.length === 1 ? 'y' : 'ies'}`);
    process.exit(0);
  }
  const stale = await staleFiles(ROOT);
  if (stale.length) errors.unshift(`${stale.join(' and ')} out of date with the code; run npm run capabilities`);
  for (const w of warnings) console.log(w);
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`docs-claims: ${errors.length} problem(s); the shipped features are in ${JSON_PATH}`);
    process.exit(1);
  }
  const files = scannedFiles(ROOT).length;
  console.log(
    `docs-claims: ${files} pages, ${claims.length} "not yet" claim(s), none about a shipped feature` +
      (baseline.length ? ` beyond ${relative(ROOT, join(ROOT, BASELINE))}` : ''),
  );
}
