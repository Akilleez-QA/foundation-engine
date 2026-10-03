// scripts/perf/bundle-check.ts (`npm run perf:bundle`): the bundle check on Vite's manifest (STANDARD chapter 12).
// - First-load JS: the entry chunks of index.html and their static imports (never dynamic ones), minified, against
//   the app budget's firstLoadJsKiB with the checker's tolerance.
// - No chunk above 500 kB unless its name is on game/budgets.json's largeChunkAllow list.
//
// Usage: tsx scripts/perf/bundle-check.ts [--dir <build dir with .vite/manifest.json>] [--build] [--json]
//   --build  builds this tree into a temp folder first (what the gate and the deploy guard do).
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_TOLERANCE} from '../../src/platform/perf/budget-check';
import {APP_BUDGET, LARGE_CHUNK_ALLOW} from '../../perf/budgets';

interface ManifestChunk {
  src?: string;
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  name?: string;
}
export interface BundleReport {
  ok: boolean;
  problems: string[];
  firstLoadJsKiB: number;
  budgetKiB: number;
  firstLoadFiles: string[];
  largeChunks: {file: string; kB: number; allowed: boolean}[];
  text: string;
}

const KIB = 1024,
  LARGE_BYTES = 500 * 1000;
export const chunkName = (file: string) => file.replace(/^.*\//, '').replace(/-[\w-]{8}\.js$/, '');

export function checkBundle(
  dir: string,
  budgetKiB = APP_BUDGET.firstLoadJsKiB,
  allow: readonly string[] = LARGE_CHUNK_ALLOW,
): BundleReport {
  const path = join(dir, '.vite', 'manifest.json');
  if (!existsSync(path))
    throw Error(`${path} is missing: build with build.manifest (tsx scripts/perf/bundle-check.ts --build)`);
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, ManifestChunk>;
  const problems: string[] = [];
  const size = (file: string) => {
    if (existsSync(join(dir, file))) return statSync(join(dir, file)).size;
    problems.push(`missing emitted file ${file}`);
    return 0;
  };
  const seen = new Map<string, ManifestChunk>();
  const walk = (key: string) => {
    if (seen.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) {
      problems.push(`missing manifest dependency ${key}`);
      return;
    }
    seen.set(key, chunk);
    for (const i of chunk.imports ?? []) walk(i);
  };
  for (const [key, c] of Object.entries(manifest)) if (c.isEntry && key.endsWith('.html')) walk(key);
  if (!seen.size) problems.push('no HTML entry in the Vite manifest');
  const firstLoadFiles = [...new Set([...seen.values()].map(c => c.file).filter(f => f.endsWith('.js')))].sort();
  const firstLoadJsKiB = Math.round((firstLoadFiles.reduce((a, f) => a + size(f), 0) / KIB) * 10) / 10;
  const files = [
    ...new Set(
      Object.values(manifest)
        .map(c => c.file)
        .filter(f => f.endsWith('.js')),
    ),
  ];
  const largeChunks = files
    .map(f => ({file: f, bytes: size(f)}))
    .filter(c => c.bytes > LARGE_BYTES)
    .map(c => ({file: c.file, kB: Math.round(c.bytes / 1000), allowed: allow.includes(chunkName(c.file))}));
  const tol = DEFAULT_TOLERANCE.firstLoadJsKiB;
  if (firstLoadJsKiB - budgetKiB > Math.max(tol.absolute, budgetKiB * tol.relative))
    problems.push(`first-load JS ${firstLoadJsKiB} KiB is over its ${budgetKiB} KiB budget`);
  for (const c of largeChunks)
    if (!c.allowed) problems.push(`chunk ${c.file} is ${c.kB} kB (> 500 kB) and not on largeChunkAllow`);
  const ok = problems.length === 0;
  const text = [
    `bundle: ${ok ? 'PASS' : 'FAIL'} · first-load JS ${firstLoadJsKiB} / ${budgetKiB} KiB (${firstLoadFiles.length} file(s)) · ${largeChunks.length} chunk(s) > 500 kB`,
    ...problems.map(p => '  ' + p),
  ].join('\n');
  return {ok, problems, firstLoadJsKiB, budgetKiB, firstLoadFiles, largeChunks, text};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const di = argv.indexOf('--dir');
  const named = di >= 0 ? argv[di + 1] : 'dist';
  if (named === undefined) throw Error('--dir needs a folder');
  let dir = named,
    temp: string | null = null;
  if (argv.includes('--build')) {
    const {build} = await import('vite');
    temp = dir = mkdtempSync(join(tmpdir(), 'engine-bundle-'));
    await build({
      root: fileURLToPath(new URL('../..', import.meta.url)),
      logLevel: 'error',
      build: {outDir: dir, emptyOutDir: true, manifest: true},
    });
  }
  try {
    const r = checkBundle(dir);
    console.log(argv.includes('--json') ? JSON.stringify(r, null, 1) : r.text);
    process.exitCode = r.ok ? 0 : 1;
  } finally {
    if (temp) rmSync(temp, {recursive: true, force: true});
  }
}
