import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetKind, readProvenance, recordProblems, type ProvenanceRecord} from './provenance';
import {provenanceVerdict} from '../lint/provenance';
import {disclose, disclosureMarkdown} from '../disclosure';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** A throwaway game folder with `files` ({path under the game: text}). */
function fixture(files: Record<string, string>) {
  const game = join(mkdtempSync(join(tmpdir(), 'provenance-')), 'game');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(game, path)), {recursive: true});
    writeFileSync(join(game, path), text);
  }
  return {game, done: () => rmSync(dirname(game), {recursive: true, force: true})};
}

const hand = (body: string, extra: Partial<ProvenanceRecord> = {}) =>
  JSON.stringify({
    origin: 'hand',
    author: 'A. Maker',
    licence: 'CC0-1.0',
    source: 'game/tools/x.mjs',
    sha256: hash(body),
    ...extra,
  });

test('assetKind: models, textures and sounds need records; data, decoders and records do not', () => {
  assert.equal(assetKind('models/a.glb'), 'model');
  assert.equal(assetKind('textures/a.KTX2'), 'texture');
  assert.equal(assetKind('sounds/a.ogg'), 'sound');
  for (const p of ['decoders/meshopt.wasm', 'models/a.provenance.json', 'models/a.contract.json', 'data.json'])
    assert.equal(assetKind(p), null, p);
});

test('recordProblems: base fields always, tool/model/prompt/edits for AI origins, licences for generators', () => {
  const base = {author: 'A', licence: 'CC0-1.0', source: 's', sha256: hash('x')};
  assert.deepEqual(recordProblems({...base, origin: 'hand'}), []);
  assert.deepEqual(recordProblems({...base, origin: 'library', source: 'https://polyhaven.com/a/rock'}), []);
  assert.match(recordProblems({...base, origin: 'bought'}).join(), /origin: expected one of hand, agent-blender/);
  assert.match(recordProblems({origin: 'hand'}).join(), /author.*licence.*source.*sha256/);
  assert.match(recordProblems({...base, origin: 'hand', sha256: 'ABC'}).join(), /sha256: required/);
  const agent = recordProblems({...base, origin: 'agent-blender'}).join('\n');
  for (const want of [/tool: required/, /model: required/, /humanEdits: required/, /prompt or reference/])
    assert.match(agent, want);
  assert.doesNotMatch(agent, /weightsLicence/);
  assert.deepEqual(
    recordProblems({
      ...base,
      origin: 'agent-blender',
      tool: 'Blender 5.2.1',
      model: 'm',
      reference: 'ref.png',
      humanEdits: 'none',
    }),
    [],
  );
  const generator = recordProblems({
    ...base,
    origin: 'ai-generator',
    tool: 't',
    model: 'm',
    prompt: 'p',
    humanEdits: 'none',
  });
  assert.deepEqual(
    generator.map(p => p.split(':')[0]),
    ['weightsLicence', 'outputLicence'],
  );
  assert.match(recordProblems({...base, origin: 'hand', tool: ''}).join(), /tool: expected a nonempty string/);
  assert.deepEqual(recordProblems([]), ['the record is not a JSON object']);
});

test('readProvenance: sidecar and central records, hash check, missing, duplicate and foreign records', () => {
  const f = fixture({
    'public/models/lantern.glb': 'glb',
    'public/models/lantern.provenance.json': hand('glb', {artifact: 'lantern.glb'}),
    'public/textures/wood.png': 'png',
    'public/textures/wood.webp': 'webp', // same stem: the sidecar names the png, so the webp needs its own record
    'public/textures/wood.provenance.json': hand('png', {artifact: 'wood.png'}),
    'public/sounds/jump.ogg': 'ogg',
    'public/sounds/hit.wav': 'wav',
    'public/sounds/hit.provenance.json': hand('wav'),
    'public/decoders/meshopt.wasm': 'wasm',
    'public/models/rock.glb': 'rock',
    'public/models/rock.provenance.json': hand('not rock'),
    'assets.provenance.json': JSON.stringify({
      schema: 1,
      assets: {'sounds/jump.ogg': JSON.parse(hand('ogg')), 'sounds/hit.wav': JSON.parse(hand('wav')), 'gone.png': {}},
      tooling: [{use: 'code', tool: 'Claude Code', model: 'Claude Opus 5.5'}],
      liveGenerated: false,
    }),
  });
  try {
    const r = readProvenance(f.game);
    const by = Object.fromEntries(r.assets.map(a => [a.path, a]));
    assert.deepEqual(Object.keys(by).sort(), [
      'models/lantern.glb',
      'models/rock.glb',
      'sounds/hit.wav',
      'sounds/jump.ogg',
      'textures/wood.png',
      'textures/wood.webp',
    ]);
    assert.deepEqual(by['models/lantern.glb']?.problems, []);
    assert.equal(by['models/lantern.glb']?.recordFile, 'public/models/lantern.provenance.json');
    assert.deepEqual(by['sounds/jump.ogg']?.problems, []);
    assert.equal(by['sounds/jump.ogg']?.recordFile, 'assets.provenance.json');
    assert.match(by['sounds/hit.wav']?.problems.join() ?? '', /two records/);
    assert.match(by['textures/wood.webp']?.problems.join() ?? '', /no provenance record/);
    assert.match(
      by['models/rock.glb']?.problems.join() ?? '',
      /sha256 does not match the file \(file is [0-9a-f]{64}\)/,
    );
    assert.deepEqual(r.problems, ['assets.provenance.json: gone.png is not a file under public/']);
    assert.deepEqual(r.declared, {
      liveGenerated: false,
      tooling: [{use: 'code', tool: 'Claude Code', model: 'Claude Opus 5.5'}],
    });
  } finally {
    f.done();
  }
});

test('readProvenance: a broken assets.provenance.json is reported, and a game without public/ has nothing to record', () => {
  const f = fixture({
    'assets.provenance.json': JSON.stringify({
      schema: 2,
      extra: 1,
      tooling: [{use: 'art'}],
      liveGenerated: 'yes',
      assets: [],
    }),
  });
  try {
    const r = readProvenance(f.game);
    assert.deepEqual(r.assets, []);
    assert.deepEqual(r.problems, [
      'assets.provenance.json: schema must be 1',
      'assets.provenance.json: unknown key extra',
      'assets.provenance.json: tooling[0] needs use (code, text, other) and tool',
      'assets.provenance.json: assets must be an object keyed by the path inside public/',
    ]);
    writeFileSync(join(f.game, 'assets.provenance.json'), '{');
    assert.match(readProvenance(f.game).problems.join(), /assets\.provenance\.json is not valid JSON/);
  } finally {
    f.done();
  }
});

test('provenanceVerdict: problems warn by default and fail only when the brief requires provenance', () => {
  const f = fixture({
    'public/sounds/a.ogg': 'a',
    'public/sounds/b.ogg': 'b',
    'public/sounds/b.provenance.json': hand('b'),
  });
  try {
    const r = readProvenance(f.game);
    const warn = provenanceVerdict(r, 'warn');
    assert.equal(warn.fail, false);
    assert.deepEqual(warn.lines.length, 1);
    assert.match(warn.lines[0] ?? '', /^warning: public\/sounds\/a\.ogg: no provenance record/);
    assert.match(warn.summary, /1\/2 .* recorded \(policy warn\)/);
    const required = provenanceVerdict(r, 'required');
    assert.equal(required.fail, true);
    assert.match(required.lines[0] ?? '', /^error: /);
    writeFileSync(join(f.game, 'public/sounds/a.provenance.json'), hand('a'));
    assert.equal(provenanceVerdict(readProvenance(f.game), 'required').fail, false);
  } finally {
    f.done();
  }
});

test('disclose: AI-made content players see is separated from development tooling, per store', () => {
  const agent = {
    origin: 'agent-blender',
    author: 'A. Maker',
    licence: 'CC0-1.0',
    source: 'game/tools/lantern/build.py',
    tool: 'Blender 5.2.1 LTS + Blender Lab MCP 1.0.3',
    model: 'Claude Opus 5.5',
    reference: 'docs/ref/lantern-front.png',
    humanEdits: 'colours retuned by hand',
  };
  const f = fixture({
    'public/models/lantern.glb': 'glb',
    'public/models/lantern.provenance.json': JSON.stringify({...agent, sha256: hash('glb')}),
    'public/textures/wood.png': 'png',
    'public/textures/wood.provenance.json': hand('png'),
    'public/sounds/jump.ogg': 'ogg',
    'public/sounds/jump.provenance.json': JSON.stringify({
      origin: 'ai-generator',
      author: 'A. Maker',
      licence: 'CC0-1.0',
      source: 'https://example.test/job/1',
      sha256: hash('ogg'),
      tool: 'SoundGen (web, Pro plan)',
      model: 'SoundGen v2',
      weightsLicence: 'proprietary service',
      outputLicence: 'SoundGen Pro terms: commercial use',
      prompt: 'a soft jump',
      humanEdits: 'none',
    }),
    'assets.provenance.json': JSON.stringify({
      schema: 1,
      tooling: [{use: 'code', tool: 'Claude Code', model: 'Claude Opus 5.5'}],
      liveGenerated: false,
    }),
  });
  try {
    const d = disclose(readProvenance(f.game), 'game');
    assert.equal(d.complete, true);
    assert.match(d.steam.preGenerated, /1 3D model built by an AI agent writing Blender scripts/);
    assert.match(d.steam.preGenerated, /1 sound generated with SoundGen \(web, Pro plan\) \(SoundGen v2\)/);
    assert.match(d.steam.preGenerated, /1 of the 2 AI-made files were then edited by a person/);
    assert.doesNotMatch(d.steam.preGenerated, /Claude Code/, 'code tooling is not player content');
    assert.match(d.steam.tooling, /Claude Code \(Claude Opus 5\.5\) for code/);
    assert.equal(d.steam.liveGenerated, 'Nothing is generated by AI while the game runs.');
    assert.deepEqual(
      d.itch.map(c => [c.category, c.answer]),
      [
        ['Graphics', 'Yes'],
        ['Sound', 'Yes'],
        ['Text & Dialog', 'No'],
        ['Code', 'Yes'],
      ],
    );
    assert.deepEqual(
      d.aiAssets.map(a => a.path),
      ['models/lantern.glb', 'sounds/jump.ogg'],
    );
    const md = disclosureMarkdown(d);
    assert.match(md, /Status: complete/);
    assert.match(md, /\| Graphics \| Yes \|/);
  } finally {
    f.done();
  }
});

test('disclose: a missing record makes the draft INCOMPLETE and never answers No for what it cannot see', () => {
  const f = fixture({
    'public/textures/a.png': 'a',
    'public/textures/b.png': 'b',
    'public/textures/b.provenance.json': hand('b'),
  });
  try {
    const d = disclose(readProvenance(f.game), 'game');
    assert.equal(d.complete, false);
    assert.match(d.steam.preGenerated, /INCOMPLETE: 1 shipped file/);
    assert.match(d.steam.liveGenerated, /^Not recorded/);
    assert.deepEqual(
      d.itch.map(c => c.answer),
      ['Unknown', 'No', 'Unknown', 'Unknown'],
    );
    assert.match(
      disclosureMarkdown(d),
      /\*\*INCOMPLETE\*\*[\s\S]*## Gaps\n\n- public\/textures\/a\.png: no provenance record/,
    );
  } finally {
    f.done();
  }
});

test('npm run lint:provenance warns on a real template without records and still exits 0 (policy warn)', () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/lint/provenance.ts', 'templates/mechanics/game'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^warning: public\/models\/mechanics\/beacon\.glb: no provenance record/m);
  assert.match(r.stdout, /lint:provenance: 0\/9 .* \(policy warn\)/);
});
