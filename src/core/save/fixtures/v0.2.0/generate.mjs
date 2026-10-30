// Regenerates the retained v0.2.0 save fixtures by running the v0.2.0 store code itself.
// It is a provenance record: the committed files are what tag v0.2.0 (071e3c2) wrote, and
// main never rewrites them. Run it from a checkout of the tag, never against main:
//
//   git worktree add --detach /tmp/v020 v0.2.0 && cd /tmp/v020 && npm ci
//   TSX_TSCONFIG_PATH=/tmp/v020/tsconfig.json node --import tsx \
//     <main>/src/core/save/fixtures/v0.2.0/generate.mjs /tmp/v020 <out-dir>
//
// Deterministic: fixed timers, an in-memory backend, fixed values. Output: one file per stored
// key holding its exact bytes, the profile export, and manifest.json with sha256 hashes.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [tag, out] = process.argv.slice(2).map(p => resolve(p));
if (!tag || !out) throw Error('usage: generate.mjs <v0.2.0 checkout> <out-dir>');
const revision = execFileSync('git', ['-C', tag, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (revision !== '071e3c2a2c9a99440088c8315aa0a1f099e0e841') throw Error(`${tag} is ${revision}, not tag v0.2.0`);
const load = path => import(pathToFileURL(resolve(tag, path)).href);
const { createSaveStore } = await load('src/core/save/store.ts');
const { MemoryBackend } = await load('src/core/save/storage-port.ts');
const { settingsValuesSection } = await load('src/core/settings/settings.ts');
const { progress } = await load('src/kits/explore/index.ts');
const best = (await load('templates/arcade/game/best.ts')).default;

const timers = { now: () => 0, set: () => 0, clear: () => {} };
const sha = text => createHash('sha256').update(text).digest('hex');
const files = [];
mkdirSync(out, { recursive: true });
const keep = (file, key, text, what) => { writeFileSync(resolve(out, file), text); files.push({ file, key, what, sha256: sha(text) }); };

// The arcade template's store, as layer-modules.ts builds it: namespace = game id, build = id@version.
{
  const backend = new MemoryBackend();
  const store = createSaveStore({ local: backend.port(), session: new MemoryBackend().port(0, 'session'), namespace: 'arcade', build: 'arcade@0.1.0', timers, sections: [best.section, settingsValuesSection] });
  store.section(best.section).update(d => { d.score = 42; d.runs = 7; });
  store.section(settingsValuesSection).update(d => { d['sound.music'] = 0.5; d['comfort.large-type'] = true; });
  store.flush('test');
  keep('arcade-run-best.json', 'arcade|p:1|run.best', backend.data.get('arcade|p:1|run.best'), 'arcade template best score (player scope)');
  keep('arcade-settings-values.json', 'arcade|device|settings.values', backend.data.get('arcade|device|settings.values'), 'device settings (device scope, never exported)');
  keep('arcade-profile-export.json', null, JSON.stringify(store.exportPlayer()), 'profile export, format engine-profile v2');
  store.dispose();
}
// The explorer template's store with the explore kit's progress section.
{
  const backend = new MemoryBackend();
  const store = createSaveStore({ local: backend.port(), session: new MemoryBackend().port(0, 'session'), namespace: 'explorer', build: 'explorer@0.1.0', timers, sections: [progress.section] });
  store.section(progress.section).update(d => { d.used = ['garden/shed-door']; d.visited = ['garden', 'shed']; d.last = 'garden/shed-door'; });
  store.flush('test');
  keep('explorer-explore-progress.json', 'explorer|p:1|explore.progress', backend.data.get('explorer|p:1|explore.progress'), 'explore kit progress (player scope)');
  store.dispose();
}
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify({
  kind: 'released-save-envelopes', release: 'v0.2.0', revision,
  generator: 'src/core/save/fixtures/v0.2.0/generate.mjs',
  generatorSha256: sha(readFileSync(fileURLToPath(import.meta.url))), node: process.version, files,
}, null, 2) + '\n');
