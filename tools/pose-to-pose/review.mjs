#!/usr/bin/env node
// Review ledger for the pose-to-pose gates: rig test poses, then one representative clip, then the rest.
// Record an approval only after the user has seen the evidence and said yes; an agent never approves
// its own work. The generator (blender/animate.py) enforces what this ledger records.
//
//   node tools/pose-to-pose/review.mjs status --review review.json [--manifest model.clips.json]
//   node tools/pose-to-pose/review.mjs approve-rig --review review.json --test-report testposes.json --by NAME
//   node tools/pose-to-pose/review.mjs approve-clip --review review.json --manifest model.clips.json --clip walk --by NAME
//   node tools/pose-to-pose/review.mjs unfreeze --review review.json --clip walk --by NAME --reason "..."
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export class ReviewError extends Error {}
const fail = message => {
  throw new ReviewError(message);
};
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const today = () => new Date().toISOString().slice(0, 10);

export function loadReview(path) {
  if (!existsSync(path)) return {schema: 1, rig: {status: 'pending'}, clips: {}, history: []};
  const review = read(path);
  if (review.schema !== 1) fail(`${path}: expected "schema": 1`);
  return {rig: {status: 'pending'}, clips: {}, history: [], ...review};
}

const save = (path, review) => writeFileSync(path, JSON.stringify(review, null, 2) + '\n');

export function approveRig(review, testReport, by, note = '') {
  if (!by) fail('--by names the person who approved');
  if (testReport.problems?.length) fail(`the test poses report problems: ${testReport.problems.join('; ')}`);
  if (!/^[0-9a-f]{64}$/.test(testReport.rigSha256 ?? '')) fail('the test-pose report has no rig hash');
  review.rig = {status: 'approved', sha256: testReport.rigSha256, sheet: testReport.sheet, by, at: today(), note};
  review.history.push({action: 'approve-rig', sha256: testReport.rigSha256, by, at: today()});
  return review;
}

export function approveClip(review, manifest, clip, by, note = '') {
  if (!by) fail('--by names the person who approved');
  if (review.rig?.status !== 'approved') fail('approve the rig test poses before any clip');
  if (manifest.rigSha256 && manifest.rigSha256 !== review.rig.sha256)
    fail('this export was made from a different rig than the approved one; re-export first');
  const entry = manifest.clips.find(c => c.name === clip);
  if (!entry) fail(`clip ${clip} is not in the manifest`);
  if (review.clips[clip]?.status === 'approved') fail(`clip ${clip} is already approved (frozen)`);
  review.clips[clip] = {status: 'approved', sampleSha256: entry.sampleSha256, by, at: today(), note};
  review.history.push({action: 'approve-clip', clip, sampleSha256: entry.sampleSha256, by, at: today()});
  return review;
}

export function unfreeze(review, clip, by, reason) {
  if (!by || !reason) fail('unfreeze needs --by and --reason');
  if (review.clips[clip]?.status !== 'approved') fail(`clip ${clip} is not approved`);
  review.clips[clip] = {status: 'unfrozen', by, at: today(), reason};
  review.history.push({action: 'unfreeze', clip, by, at: today(), reason});
  return review;
}

export function status(review, manifest) {
  const clips = manifest ? manifest.clips.map(c => c.name) : Object.keys(review.clips);
  return {
    rig: review.rig.status,
    clips: Object.fromEntries(
      clips.map(name => {
        const r = review.clips[name];
        const m = manifest?.clips.find(c => c.name === name);
        let state = r?.status ?? 'draft';
        if (state === 'approved' && m && m.sampleSha256 !== r.sampleSha256) state = 'approved-but-changed';
        return [name, state];
      }),
    ),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const opt = name => {
    const i = rest.indexOf(name);
    return i < 0 ? undefined : rest[i + 1];
  };
  try {
    const path = opt('--review');
    if (!path) fail('--review review.json is required');
    const review = loadReview(path);
    if (command === 'status') {
      console.log(JSON.stringify(status(review, opt('--manifest') && read(opt('--manifest'))), null, 2));
    } else if (command === 'approve-rig') {
      save(path, approveRig(review, read(opt('--test-report')), opt('--by'), opt('--note')));
      console.log(`rig approved by ${opt('--by')}`);
    } else if (command === 'approve-clip') {
      save(path, approveClip(review, read(opt('--manifest')), opt('--clip'), opt('--by'), opt('--note')));
      console.log(`clip ${opt('--clip')} approved and frozen`);
    } else if (command === 'unfreeze') {
      save(path, unfreeze(review, opt('--clip'), opt('--by'), opt('--reason')));
      console.log(`clip ${opt('--clip')} unfrozen; it needs approval again`);
    } else fail('commands: status, approve-rig, approve-clip, unfreeze');
  } catch (error) {
    console.error(`pose-to-pose review: ${error.message}`);
    process.exit(1);
  }
}
