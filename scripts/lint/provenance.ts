// scripts/lint/provenance.ts (`npm run lint:provenance`, part of `npm run check`): every model, texture and sound the
// game ships under public/ has a complete provenance record whose hash matches the file
// (docs/guides/asset-provenance.md). By default a problem is a warning (exit 0); a brief with
// `assets: { provenance: 'required' }` makes it an error (exit 1).
//
//   tsx scripts/lint/provenance.ts [game folder]     default: the active game (GAME_DIR, ./game, the blank template)
import {join, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gameDir, ROOT} from '../lib/game-dir.mjs';
import {gamePublicDir} from '../lib/game-public.mjs';
import {readProvenance, type ProvenanceReport} from '../lib/provenance';
import type {BuildBrief} from '../../src/author/build';

/** The lines to print and whether they fail the check under `policy`. */
export function provenanceVerdict(report: ProvenanceReport, policy: BuildBrief['assets']['provenance']) {
  const label = policy === 'required' ? 'error' : 'warning';
  const lines = [
    ...report.problems.map(p => `${label}: ${p}`),
    ...report.assets.flatMap(a => a.problems.map(p => `${label}: public/${a.path}: ${p}`)),
  ];
  const recorded = report.assets.filter(a => a.record && !a.problems.length).length;
  const summary = `lint:provenance: ${recorded}/${report.assets.length} shipped model, texture and sound file(s) recorded (policy ${policy})`;
  return {lines, summary, fail: policy === 'required' && lines.length > 0};
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(`scripts${sep}lint${sep}provenance.ts`)) {
  const dir = resolve(ROOT, process.argv[2] ?? gameDir());
  const brief = ((await import(pathToFileURL(join(dir, 'build.brief.ts')).href)) as {default: BuildBrief}).default;
  const report = readProvenance(dir, gamePublicDir({game: join(dir, 'public')}));
  const {lines, summary, fail} = provenanceVerdict(report, brief.assets.provenance);
  for (const line of lines) console.log(line);
  if (lines.length)
    console.log(
      `${relative(ROOT, dir).split(sep).join('/')}: see docs/guides/asset-provenance.md; npm run disclosure needs complete records`,
    );
  console.log(summary);
  process.exitCode = fail ? 1 : 0;
}
