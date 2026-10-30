import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {addTake, approvePose, markPose, setStatus, sheet, trackedInRepo} from './reference.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'pose-to-pose-reference-'));
after(() => rmSync(scratch, {recursive: true, force: true}));
const ledger = () => ({schema: 1, takes: {}});
const fields = {file: '/refs/walk.mp4', provider: 'a video model', plan: 'paid plan, commercial use', prompt: 'walk'};
const poses = () => ({schema: 1, poses: {contact: {source: {kind: 'json'}, bones: {}}}});

test('a take records who made it and under which terms; a reference inside the repository needs its terms', () => {
  const l = addTake(ledger(), 'walk-01', fields, {bytes: Buffer.from('clip'), inRepo: false});
  assert.equal(l.takes['walk-01'].status, 'new');
  assert.equal(l.takes['walk-01'].committed, false);
  assert.match(l.takes['walk-01'].sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => addTake(ledger(), 'x', {...fields, plan: undefined}, {bytes: Buffer.alloc(0)}), /--plan/);
  assert.throws(() => addTake(ledger(), 'x', fields, {bytes: Buffer.alloc(0), inRepo: true}), /out of the repository/);
  assert.equal(
    addTake(ledger(), 'x', {...fields, licence: 'CC0-1.0'}, {bytes: Buffer.alloc(0), inRepo: true}).takes.x.committed,
    true,
  );
  assert.equal(trackedInRepo(join(tmpdir(), 'elsewhere.mp4')), false);
});

test('poses match only a selected take, and stay pending until the user approves the side-by-side', () => {
  const l = addTake(ledger(), 'walk-01', fields, {bytes: Buffer.from('clip'), inRepo: false});
  assert.throws(() => markPose(poses(), 'contact', l, 'walk-01', 0.5), /select a take/);
  assert.throws(() => setStatus(l, 'walk-01', 'selected'), /--by/);
  setStatus(l, 'walk-01', 'selected', 'Ada');
  const p = markPose(poses(), 'contact', l, 'walk-01', 0.5);
  assert.deepEqual(p.poses.contact.approval, {status: 'pending'});
  assert.equal(p.poses.contact.source.take, 'walk-01');
  assert.throws(() => approvePose(p, 'contact', ''), /--by/);
  assert.equal(approvePose(p, 'contact', 'Ada').poses.contact.approval.status, 'approved');
  assert.throws(() => approvePose(poses(), 'contact', 'Ada'), /not matched to a reference frame/);
  assert.deepEqual(
    l.takes['walk-01'].history.map(h => [h.from, h.to]),
    [['new', 'selected']],
  );
});

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('the contact sheet stamps each frame with its source time', {skip: !ffmpeg && 'ffmpeg not installed'}, () => {
  const clip = join(scratch, 'test.mp4');
  const make = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=2:size=160x120:rate=24',
    clip,
  ]);
  assert.equal(make.status, 0);
  const out = join(scratch, 'sheet');
  const frames = sheet(clip, out, {fps: 4, start: 0.5, duration: 1, columns: 4, width: 160});
  assert.deepEqual(
    frames.map(f => f.seconds),
    [0.5, 0.75, 1, 1.25],
  );
  assert.ok(existsSync(join(out, 'sheet.png')));
  assert.equal(JSON.parse(readFileSync(join(out, 'frames.json'), 'utf8')).frames.length, 4);
});
