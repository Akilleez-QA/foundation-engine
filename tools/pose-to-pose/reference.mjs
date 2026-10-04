#!/usr/bin/env node
// Reference-video intake for key poses: a take ledger, timestamped ffmpeg contact sheets, single frames
// for side-by-side matching, and the user's approval of each matched pose.
//
// Reference clips (AI-generated or filmed) are inputs only: keep them out of the repository. The ledger
// records each take's source, prompt, provider, plan or licence, and its review status. Agents judge
// 3D poses from images poorly, so every pose matched to a reference frame needs the user's approval
// of its side-by-side before the generator will use it.
//
//   node tools/pose-to-pose/reference.mjs add --ledger refs/ledger.json --take walk-01 --file ~/refs/walk.mp4 \
//        --provider "<service and model>" --plan "<plan and terms>" --prompt "<prompt>" [--source <url>] [--licence <id>]
//   node tools/pose-to-pose/reference.mjs sheet --ledger refs/ledger.json --take walk-01 --out refs/walk-01 [--fps 8]
//        [--start 0] [--duration 4] [--columns 6] [--width 320]
//   node tools/pose-to-pose/reference.mjs frame --ledger refs/ledger.json --take walk-01 --seconds 1.25 --out ref.png
//   node tools/pose-to-pose/reference.mjs status --ledger refs/ledger.json --take walk-01 --set selected [--by NAME] [--note ...]
//   node tools/pose-to-pose/reference.mjs mark-pose --ledger refs/ledger.json --poses poses.json --pose contact \
//        --take walk-01 --seconds 1.25
//   node tools/pose-to-pose/reference.mjs approve-pose --poses poses.json --pose contact --by NAME
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STATUSES = ['new', 'reviewed', 'selected', 'approved', 'rejected'];
export class ReferenceError_ extends Error {}
const fail = message => {
  throw new ReferenceError_(message);
};
const today = () => new Date().toISOString().slice(0, 10);
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
};

export function loadLedger(path) {
  if (!existsSync(path)) return {schema: 1, takes: {}};
  const ledger = readJson(path);
  if (ledger.schema !== 1 || typeof ledger.takes !== 'object') fail(`${path}: expected {"schema": 1, "takes": {...}}`);
  return ledger;
}

/** True when `file` is inside this repository and git would track it. */
export function trackedInRepo(file, root = ROOT) {
  const rel = relative(root, resolve(file));
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  const ignored = spawnSync('git', ['check-ignore', '-q', rel], {cwd: root});
  return ignored.status !== 0;
}

export function addTake(ledger, take, fields, {bytes, inRepo}) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(take ?? '')) fail('--take is 1-64 letters, digits, _ or -');
  if (ledger.takes[take]) fail(`take ${take} is already in the ledger`);
  for (const key of ['provider', 'plan'])
    if (!fields[key]) fail(`--${key} is required: record who made the clip and under which terms`);
  if (inRepo && !fields.licence)
    fail(
      'the reference file is inside the repository and not ignored: keep reference video out of the repository, ' +
        'or record its source and terms with --source and --licence before committing it',
    );
  ledger.takes[take] = {
    file: fields.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: fields.source ?? null,
    prompt: fields.prompt ?? null,
    provider: fields.provider,
    plan: fields.plan,
    licence: fields.licence ?? null,
    committed: Boolean(inRepo),
    status: 'new',
    added: today(),
    history: [],
  };
  return ledger;
}

export function setStatus(ledger, take, status, by, note = '') {
  const entry = ledger.takes[take];
  if (!entry) fail(`take ${take} is not in the ledger`);
  if (!STATUSES.includes(status)) fail(`status is one of ${STATUSES.join(', ')}`);
  if ((status === 'approved' || status === 'selected') && !by) fail(`--by names the person who ${status} the take`);
  entry.history.push({from: entry.status, to: status, by: by ?? null, at: today(), note});
  entry.status = status;
  return ledger;
}

export function markPose(posesFile, pose, ledger, take, seconds) {
  const entry = ledger.takes[take];
  if (!entry) fail(`take ${take} is not in the ledger`);
  if (!['selected', 'approved'].includes(entry.status))
    fail(`take ${take} is ${entry.status}: select a take before matching poses to it`);
  if (!Number.isFinite(seconds) || seconds < 0) fail('--seconds is the reference time of the matched frame');
  const target = posesFile.poses[pose];
  if (!target) fail(`pose ${pose} is not in the pose file; author it first, then mark it`);
  target.source = {kind: 'reference', take, seconds, file: entry.file, sha256: entry.sha256};
  target.approval = {status: 'pending'};
  return posesFile;
}

export function approvePose(posesFile, pose, by, note = '') {
  const target = posesFile.poses[pose];
  if (!target) fail(`pose ${pose} is not in the pose file`);
  if (target.source?.kind !== 'reference') fail(`pose ${pose} is not matched to a reference frame`);
  if (!by) fail('--by names the person who approved the side-by-side');
  target.approval = {status: 'approved', by, at: today(), note};
  return posesFile;
}

function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {encoding: 'utf8'});
  if (run.error) fail(`ffmpeg is needed for reference frames: ${run.error.message}`);
  if (run.status !== 0) fail(`ffmpeg failed: ${run.stderr.trim()}`);
}
const hasDrawtext = () =>
  / drawtext /.test(spawnSync('ffmpeg', ['-hide_banner', '-filters'], {encoding: 'utf8'}).stdout ?? '');

/** Frames at `fps`, each stamped with its source time, plus one tiled contact sheet and frames.json. */
export function sheet(file, out, {fps = 8, start = 0, duration, columns = 6, width = 320} = {}) {
  mkdirSync(out, {recursive: true});
  const range = ['-ss', String(start), ...(duration ? ['-t', String(duration)] : [])];
  const stamp = hasDrawtext()
    ? `,drawtext=text='%{pts\\:hms}  #%{frame_num}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6`
    : '';
  // setpts keeps the source time on each frame so the stamp shows where in the clip it came from.
  ffmpeg([
    ...range,
    '-i',
    file,
    '-vf',
    `setpts=PTS+${start}/TB,fps=${fps},scale=${width}:-2${stamp}`,
    resolve(out, 'frame_%04d.png'),
  ]);
  const frames = [];
  for (let i = 1; existsSync(resolve(out, `frame_${String(i).padStart(4, '0')}.png`)); i++)
    frames.push({
      index: i,
      seconds: Number((start + (i - 1) / fps).toFixed(4)),
      file: `frame_${String(i).padStart(4, '0')}.png`,
    });
  if (!frames.length) fail('ffmpeg produced no frames: check --start and --duration');
  const rows = Math.ceil(frames.length / columns);
  ffmpeg([
    '-framerate',
    '1',
    '-i',
    resolve(out, 'frame_%04d.png'),
    '-vf',
    `tile=${columns}x${rows}:padding=4:color=0x1c2129`,
    '-frames:v',
    '1',
    resolve(out, 'sheet.png'),
  ]);
  writeJson(resolve(out, 'frames.json'), {schema: 1, fps, start, timestamps: Boolean(stamp), frames});
  return frames;
}

export function frame(file, seconds, out) {
  mkdirSync(dirname(out), {recursive: true});
  ffmpeg(['-ss', String(seconds), '-i', file, '-frames:v', '1', out]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const opt = name => {
    const i = rest.indexOf(name);
    return i < 0 ? undefined : rest[i + 1];
  };
  const num = (name, fallback) => (opt(name) === undefined ? fallback : Number(opt(name)));
  try {
    if (command === 'add') {
      const path = opt('--ledger'),
        file = opt('--file');
      if (!path || !file || !existsSync(file)) fail('add needs --ledger and an existing --file');
      const ledger = addTake(
        loadLedger(path),
        opt('--take'),
        {
          file: resolve(file),
          source: opt('--source'),
          prompt: opt('--prompt'),
          provider: opt('--provider'),
          plan: opt('--plan'),
          licence: opt('--licence'),
        },
        {bytes: readFileSync(file), inRepo: trackedInRepo(file)},
      );
      writeJson(path, ledger);
      console.log(`take ${opt('--take')} added (status new)`);
    } else if (command === 'sheet') {
      const ledger = loadLedger(opt('--ledger'));
      const take = ledger.takes[opt('--take')] ?? fail(`take ${opt('--take')} is not in the ledger`);
      const out = resolve(opt('--out') ?? fail('--out is required'));
      const frames = sheet(take.file, out, {
        fps: num('--fps', 8),
        start: num('--start', 0),
        duration: opt('--duration') && Number(opt('--duration')),
        columns: num('--columns', 6),
        width: num('--width', 320),
      });
      take.sheets = [...(take.sheets ?? []), {out, fps: num('--fps', 8), frames: frames.length, at: today()}];
      writeJson(opt('--ledger'), ledger);
      console.log(`${frames.length} frames and sheet.png -> ${out}`);
    } else if (command === 'frame') {
      const take = loadLedger(opt('--ledger')).takes[opt('--take')] ?? fail('unknown take');
      frame(take.file, num('--seconds', NaN), resolve(opt('--out') ?? fail('--out is required')));
      console.log(`frame at ${opt('--seconds')} s -> ${opt('--out')}`);
    } else if (command === 'status') {
      const path = opt('--ledger');
      writeJson(path, setStatus(loadLedger(path), opt('--take'), opt('--set'), opt('--by'), opt('--note')));
      console.log(`take ${opt('--take')} is ${opt('--set')}`);
    } else if (command === 'mark-pose') {
      const posesPath = opt('--poses');
      const poses = markPose(
        readJson(posesPath),
        opt('--pose'),
        loadLedger(opt('--ledger')),
        opt('--take'),
        num('--seconds', NaN),
      );
      writeJson(posesPath, poses);
      console.log(`pose ${opt('--pose')} matched to ${opt('--take')} at ${opt('--seconds')} s; approval pending`);
    } else if (command === 'approve-pose') {
      const posesPath = opt('--poses');
      writeJson(posesPath, approvePose(readJson(posesPath), opt('--pose'), opt('--by'), opt('--note')));
      console.log(`pose ${opt('--pose')} approved by ${opt('--by')}`);
    } else fail('commands: add, sheet, frame, status, mark-pose, approve-pose');
  } catch (error) {
    console.error(`pose-to-pose reference: ${error.message}`);
    process.exit(1);
  }
}
