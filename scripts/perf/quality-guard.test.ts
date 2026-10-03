import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {must} from '../../src/testing/must';
const load = (path: string) => import(path);
const {encodePng, decodePng, comparePixels, crc32} = await load('./quality-png.mjs');
const {validateViews, parseArgs, judge, reviewedSignOff} = await load('./quality-guard.mjs');
const image = (width = 1000, height = 1) => ({width, height, data: Buffer.alloc(width * height * 4, 255)});
const view = {id: 'arrival', scene: 'scene.main', route: '#main', mode: 'identical'};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('identical compares decoded pixels, including alpha, with zero tolerance', () => {
  const a = image(),
    b = image();
  assert.equal(comparePixels(a, b, 'identical').pass, true);
  b.data[3] = must(b.data[3], 'pixel byte 3') - 1;
  const r = comparePixels(a, b, 'identical');
  assert.equal(r.pass, false);
  assert.equal(r.different, 1);
  assert.equal(r.beyondTolerance, 0);
});

test('near allows 2/255 everywhere and exactly 0.1 % beyond it; one more fails', () => {
  const a = image(),
    b = image();
  b.data.fill(253);
  assert.equal(comparePixels(a, b, 'near').pass, true);
  b.data[0] = 252;
  const edge = comparePixels(a, b, 'near');
  assert.equal(edge.pass, true);
  assert.equal(edge.beyondTolerance, 1);
  assert.equal(edge.limit, 1);
  b.data[4] = 252;
  assert.equal(comparePixels(a, b, 'near').pass, false);
  const small = image(999),
    changed = image(999);
  changed.data[0] = 252;
  assert.equal(comparePixels(small, changed, 'near').pass, false, 'the budget is never rounded upward');
});

test('reviewed passes only with a sign-off for exactly this pair of pictures', () => {
  const base = encodePng(image()),
    head = encodePng({...image(), data: Buffer.alloc(4000, 7)});
  const reviewedView = {...view, mode: 'reviewed'};
  assert.equal(judge(base, head, reviewedView, []).pass, false, 'never silently');
  assert.equal(judge(base, base, reviewedView, []).pass, false, 'not even for identical pictures');
  const row = {view: 'arrival', base: sha(base), head: sha(head), by: 'art lead', note: 'new floor colour'};
  assert.equal(judge(base, head, reviewedView, [row]).pass, true);
  assert.equal(
    judge(base, encodePng(image()), reviewedView, [row]).pass,
    false,
    'another head picture needs another review',
  );
  assert.equal(
    reviewedSignOff([{...row, by: ''}], 'arrival', row.base, row.head),
    null,
    'a sign-off names its reviewer',
  );
  assert.throws(() => comparePixels(image(), image(), 'anything'), /Unknown/);
});

test('views and arguments fail closed: no empty coverage, no custom tolerance, no missing build', () => {
  assert.equal(validateViews([view]).length, 1);
  for (const views of [
    [],
    [view, view],
    [{...view, mode: 'weak'}],
    [{...view, scene: 'main'}],
    [{...view, route: 'main'}],
    [{...view, channelTolerance: 10}],
    [{...view, settleMs: -1}],
  ])
    assert.throws(() => validateViews(views));
  assert.throws(() => parseArgs(['--base', '/tmp/a']), /missing --head/);
  assert.throws(() => parseArgs(['--tolerance', '5']), /invalid argument/);
  assert.equal(parseArgs(['--help']), null);
});

test('PNG round-trip preserves all channels; corrupt or truncated evidence is rejected', () => {
  const a = image(3, 2);
  a.data.set([0, 18, 252, 0, 129, 88, 5, 254]);
  assert.deepEqual(decodePng(encodePng(a)), a);
  const png = encodePng(image(2, 2)),
    corrupt = Buffer.from(png);
  corrupt[45] = must(corrupt[45], 'PNG byte 45') ^ 1;
  assert.throws(() => decodePng(corrupt), /CRC/);
  assert.throws(() => decodePng(png.subarray(0, -3)), /Truncated/);
  assert.throws(() => encodePng(image(0)), /dimensions/);
  assert.equal(typeof crc32(Buffer.from('x')), 'number');
  assert.ok(deflateSync(Buffer.alloc(1)).length > 0);
});
