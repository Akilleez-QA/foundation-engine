#!/usr/bin/env node
// Runs a worked example end to end with a real Blender (default `blender`, or $BLENDER), headless:
// build the model, rig it, author its poses (no user present), render the rig test poses, generate the
// clips, verify the re-import, validate the GLB and render the contact sheets.
//
//   node tools/pose-to-pose/pipeline.mjs <example> [--work <dir>] [--sheets <dir>]
//
// <example> is a folder in tools/pose-to-pose/examples with an example.json. The GLB, its clips manifest
// and provenance go to tools/pose-to-pose/game/public/models/. Intermediate .blend files go to --work
// (default: a fresh temporary folder). Nothing here opens or saves a user's Blender session.
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validate} from './validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MODELS = join(HERE, 'game/public/models');

function blender(script, args) {
  const bin = process.env.BLENDER || 'blender';
  const run = spawnSync(
    bin,
    ['--background', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', ...args],
    {cwd: HERE, encoding: 'utf8'},
  );
  const lines = `${run.stdout}\n${run.stderr}`.split('\n').filter(l => /pose-to-pose|Error|Traceback/.test(l));
  for (const line of lines) console.log('  ' + line);
  if (run.error) throw Error(`cannot run ${bin}: ${run.error.message} (set BLENDER to the Blender 5.2 executable)`);
  if (run.status !== 0) throw Error(`${relative(ROOT, script)} failed with exit code ${run.status}`);
}

export async function runExample(name, {work, sheets} = {}) {
  const dir = join(HERE, 'examples', name);
  const ex = JSON.parse(readFileSync(join(dir, 'example.json'), 'utf8'));
  work ??= mkdtempSync(join(tmpdir(), `pose-to-pose-${name}-`));
  sheets ??= work;
  mkdirSync(work, {recursive: true});
  mkdirSync(sheets, {recursive: true});
  mkdirSync(MODELS, {recursive: true});
  const at = f => join(dir, f),
    w = f => join(work, f);
  const glb = join(MODELS, `${ex.name}.glb`);
  console.log(`[1/8] build ${ex.name}`);
  blender(at(ex.build), ['--out', w('model.blend'), ...(ex.skeleton ? ['--skeleton-out', w('skeleton.json')] : [])]);
  console.log('[2/8] rig');
  const rigArgs = ['--input', w('model.blend'), '--kind', ex.kind, '--name', ex.name];
  if (ex.landmarks) rigArgs.push('--landmarks', at(ex.landmarks));
  if (ex.skeleton) rigArgs.push('--skeleton', w('skeleton.json'));
  if (ex.rigidBind) rigArgs.push('--rigid-bind', ex.rigidBind);
  blender(join(HERE, 'blender/rig.py'), [...rigArgs, '--out', w('rigged.blend'), '--report', w('rig-report.json')]);
  console.log('[3/8] author key poses (agent-authored: no user was present to pose this example)');
  blender(at(ex.author), ['--rigged', w('rigged.blend'), '--out', at(ex.poses), '--test-out', at(ex.testPoses)]);
  console.log('[4/8] rig test poses');
  blender(join(HERE, 'blender/test_poses.py'), [
    '--rigged',
    w('rigged.blend'),
    '--poses',
    at(ex.testPoses),
    '--out',
    join(sheets, `${ex.name}-testposes.png`),
    '--report',
    w('testposes.json'),
  ]);
  console.log('[5/8] generate clips (review gate off: no user was present to approve; recorded in provenance)');
  blender(join(HERE, 'blender/animate.py'), [
    '--rigged',
    w('rigged.blend'),
    '--poses',
    at(ex.poses),
    '--definition',
    at(ex.definition),
    '--out',
    glb,
    '--provenance',
    at('authorship.json'),
    '--no-review',
  ]);
  console.log('[6/8] verify the re-import from a copied folder');
  blender(join(HERE, 'blender/verify.py'), [
    '--glb',
    glb,
    '--rigged',
    w('rigged.blend'),
    '--poses',
    at(ex.poses),
    '--definition',
    at(ex.definition),
    '--report',
    w('verify.json'),
  ]);
  console.log('[7/8] validate');
  const report = await validate(glb, at(ex.definition), {allowUnreviewed: true});
  for (const [clip, c] of Object.entries(report.clips))
    console.log(
      `  ${clip}: ${c.playback} ${c.frames} frames ${c.duration.toFixed(3)} s` +
        (c.feet ? `, max foot slide ${Math.max(...c.feet.map(f => f.maxSlide)).toFixed(3)} m` : ''),
    );
  if (!report.passed) throw Error('validation failed:\n  ' + report.failures.join('\n  '));
  console.log('[8/8] contact sheets');
  for (const sheet of ex.sheets)
    blender(join(HERE, 'blender/contact_sheet.py'), [
      '--glb',
      glb,
      '--out',
      join(sheets, `${ex.name}-${sheet.clip}.png`),
      '--clip',
      sheet.clip,
      '--view',
      sheet.view,
      '--every',
      String(sheet.every),
    ]);
  console.log(`done: ${relative(ROOT, glb)}; sheets in ${sheets}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = flag => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : resolve(args.splice(i, 2)[1]);
  };
  const work = opt('--work'),
    sheets = opt('--sheets');
  if (args.length !== 1) {
    console.error('usage: pipeline.mjs <example> [--work <dir>] [--sheets <dir>]');
    process.exit(2);
  }
  try {
    await runExample(args[0], {work, sheets});
  } catch (error) {
    console.error(`pose-to-pose pipeline: ${error.message}`);
    process.exit(1);
  }
}
