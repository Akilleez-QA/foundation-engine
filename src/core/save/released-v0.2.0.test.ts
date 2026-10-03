/**
 * Retained v0.2.0 save envelopes: bytes written by the released store code (tag v0.2.0, 071e3c2), not hand-written.
 * `fixtures/v0.2.0/generate.mjs` records how they were made; its manifest pins every file by sha256. Never rewrite
 * these files to make a test pass: a break is a migration to write, or a documented recovery route.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {MemoryBackend} from './storage-port';
import {createSaveStore, type Timers} from './store';
import type {SaveSection} from './section';
import {settingsValuesSection} from '../settings/settings';
import {progress} from '../../kits/explore/index';
import best from '../../../templates/arcade/game/best';

interface Entry {file:string; key:string|null; sha256:string}
const dir = new URL('./fixtures/v0.2.0/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as {release:string; revision:string; generator:string; generatorSha256:string; files:Entry[]};
const sha = (bytes:string|Buffer) => createHash('sha256').update(bytes).digest('hex');
/** The fixture's exact bytes, refused when they no longer match the manifest. */
function retained(file:string, read = (f:string) => readFileSync(new URL(f, dir))): string {
  const entry = manifest.files.find(e => e.file === file);
  if (!entry) throw Error(`${file} is not in the v0.2.0 manifest`);
  const bytes = read(file);
  if (sha(bytes) !== entry.sha256) throw Error(`${file} does not match its v0.2.0 manifest hash`);
  return bytes.toString('utf8');
}
const timers:Timers = {now:()=>0, set:()=>0, clear:()=>{}};
function owner(backend:MemoryBackend, namespace:string, sections:SaveSection<any>[]) {
  return createSaveStore({local:backend.port(), session:new MemoryBackend().port(0, 'session'), namespace, build:`${namespace}@current`, timers, sections});
}
const cases: {file:string; ns:string; section:SaveSection<any>; expected:unknown}[] = [
  {file:'arcade-run-best.json', ns:'arcade', section:best.section, expected:{score:42, runs:7}},
  {file:'arcade-settings-values.json', ns:'arcade', section:settingsValuesSection, expected:{'sound.music':0.5, 'comfort.large-type':true}},
  {file:'explorer-explore-progress.json', ns:'explorer', section:progress.section, expected:{used:['garden/shed-door'], visited:['garden', 'shed'], last:'garden/shed-door'}},
];

test('the v0.2.0 manifest pins the released revision, its generator and every fixture', () => {
  assert.equal(manifest.release, 'v0.2.0');
  assert.equal(manifest.revision, '071e3c2a2c9a99440088c8315aa0a1f099e0e841');
  assert.equal(sha(readFileSync(new URL('generate.mjs', dir))), manifest.generatorSha256, 'generator changed after the fixtures were made');
  assert.deepEqual(manifest.files.map(e => e.file).sort(), ['arcade-profile-export.json', ...cases.map(c => c.file)].sort());
  for (const e of manifest.files) assert.doesNotThrow(() => retained(e.file), e.file);
});

test('a hash-mismatched v0.2.0 fixture fails the manifest check', () => {
  const tampered = (f:string) => Buffer.from(readFileSync(new URL(f, dir), 'utf8').replace('42', '43'));
  assert.throws(() => retained('arcade-run-best.json', tampered), /does not match its v0.2.0 manifest hash/);
  assert.throws(() => retained('unknown.json'), /not in the v0.2.0 manifest/);
});

for (const c of cases) test(`v0.2.0 ${c.file} loads with current code and keeps its exact bytes across flush and reload`, () => {
  const raw = retained(c.file), key = manifest.files.find(e => e.file === c.file)!.key!;
  const backend = new MemoryBackend();backend.data.set(key, raw);
  const first = owner(backend, c.ns, [c.section]);
  try {
    const handle = first.section(c.section);
    assert.equal(handle.status(), 'saved');assert.deepEqual(handle.get(), c.expected);
    first.flush();
    assert.equal(backend.data.get(key), raw, 'a current-version envelope is not rewritten');
    assert.deepEqual([...backend.data.keys()].filter(k => k.includes('-bak|') || k.includes('-q|')), [], 'no backup or quarantine');
  } finally {first.dispose();}
  const second = owner(backend, c.ns, [c.section]);
  try {assert.deepEqual(second.section(c.section).get(), c.expected);} finally {second.dispose();}
  assert.equal(backend.data.get(key), raw);
});

test('the v0.2.0 profile export (engine-profile v2) imports into a fresh current store', () => {
  const raw = retained('arcade-profile-export.json');
  const backend = new MemoryBackend(), store = owner(backend, 'arcade', [best.section, settingsValuesSection]);
  try {
    const report = store.importPlayer(raw);
    assert.equal(report.format, 'engine-profile@2');
    assert.deepEqual(report.sections, {'run.best':'saved'});
    assert.deepEqual(store.section(best.section).get(), {score:42, runs:7});
    assert.equal(store.section(settingsValuesSection).get()['sound.music'], undefined, 'device settings are never in a profile export');
  } finally {store.dispose();}
  const again = owner(backend, 'arcade', [best.section]);
  try {assert.deepEqual(again.section(best.section).get(), {score:42, runs:7});} finally {again.dispose();}
});

test('a corrupted v0.2.0 envelope is quarantined with its original bytes kept', () => {
  const raw = retained('arcade-run-best.json'), key = 'arcade|p:1|run.best', corrupt = raw.slice(0, -7);
  const backend = new MemoryBackend();backend.data.set(key, corrupt);
  const store = owner(backend, 'arcade', [best.section]);
  try {
    const handle = store.section(best.section);
    assert.equal(handle.status(), 'quarantined');assert.deepEqual(handle.get(), {score:0, runs:0});
    handle.update(d => {d.score = 5;});store.flush();
    assert.equal(backend.data.get(`arcade-q|${key}`), corrupt, 'original bytes kept for recovery');
    assert.deepEqual(JSON.parse(backend.data.get(key)!).data, {score:5, runs:0});
  } finally {store.dispose();}
});

test('a future-version envelope built from v0.2.0 bytes stays read-only', () => {
  const raw = retained('arcade-run-best.json').replace('"v":1', '"v":99'), key = 'arcade|p:1|run.best';
  const backend = new MemoryBackend();backend.data.set(key, raw);
  for (let attempt = 0; attempt < 2; attempt++) {
    const store = owner(backend, 'arcade', [best.section]);
    try {
      const handle = store.section(best.section);
      assert.equal(handle.status(), 'newer');
      handle.update(d => {d.score = 1;});store.flush();
      assert.equal(backend.data.get(key), raw);
    } finally {store.dispose();}
    assert.equal(backend.data.get(key), raw, 'disposal cannot overwrite unsupported data');
  }
});
