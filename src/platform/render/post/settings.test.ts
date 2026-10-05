import test from 'node:test';
import assert from 'node:assert/strict';
import {coreKnobs} from '../quality';
import {
  bloomSizes,
  POST_DEFAULTS,
  POST_DRAWS,
  postDrawsOf,
  postKey,
  postPlan,
  postTargetBytes,
  resolvePost,
  validatePost,
  type PostSettings,
} from './settings';

test('post settings fill defaults and validate every field, naming it', () => {
  const r = resolvePost({});
  assert.deepEqual(r.bloom, POST_DEFAULTS.bloom);
  assert.equal(r.vignette.amount, 0);
  assert.deepEqual(r.grade, {lift: [0, 0, 0], gain: [1, 1, 1], saturation: 1, lut: null});
  assert.equal(r.ceiling, null, 'no HDR ceiling unless asked for');
  assert.equal(resolvePost({bloom: false}).bloom, null, 'bloom: false turns the glow off');
  const full = resolvePost({
    bloom: {strength: 1.2, threshold: 0.9, radius: 0.3},
    vignette: {amount: 0.45},
    grade: {lift: [0, 0.005, 0.03], gain: [1.05, 1, 0.95], saturation: 1.05},
  });
  assert.deepEqual(full.bloom, {strength: 1.2, threshold: 0.9, radius: 0.3});
  const bad: [unknown, RegExp][] = [
    [{bloom: {strength: 4}}, /view\.post\.bloom\.strength must be a number from 0 to 3/],
    [{bloom: {threshold: -1}}, /bloom\.threshold/],
    [{bloom: {radius: Number.NaN}}, /bloom\.radius/],
    [{bloom: {glow: 1}}, /bloom\.glow is unknown/],
    [{vignette: {amount: 2}}, /vignette\.amount/],
    [{grade: {lift: [0, 0]}}, /grade\.lift must be three numbers/],
    [{grade: {gain: [1, 1, 5]}}, /grade\.gain channels must be from 0 to 4/],
    [{grade: {saturation: 3}}, /grade\.saturation/],
    [{sharpen: 1}, /view\.post\.sharpen is unknown/],
    [null, /view\.post must be an object/],
    [{bloom: true}, /view\.post\.bloom must be an object/],
  ];
  for (const [value, message] of bad) assert.throws(() => resolvePost(value as PostSettings), message);
  const input: PostSettings = {vignette: {amount: 0.2}};
  const copy = validatePost(input);
  assert.notEqual(copy, input, 'a scene keeps its own copy');
  assert.deepEqual(copy, input);
});

test('the tier mapping is exact: off draws direct, basic has no glow, full adds bloom only when asked for', () => {
  const knob = coreKnobs.find(k => k.id === 'post.mode')!;
  assert.deepEqual(knob.presets, {reference: 'full', high: 'full', medium: 'basic', low: 'off'});
  assert.deepEqual(knob.wired, {by: 'scenePost'}, 'shown on the Graphics screen');
  assert.equal(knob.owner, 'platform.render.post');
  const settings = resolvePost({vignette: {amount: 0.4}});
  assert.equal(postPlan(settings, 'off'), null);
  assert.equal(postPlan(null, 'full'), null, 'no settings: no post at any tier');
  const basic = postPlan(settings, 'basic')!;
  assert.equal(basic.mode, 'basic');
  assert.equal(basic.bloom, null);
  assert.equal(basic.vignette.amount, 0.4);
  const full = postPlan(settings, 'full')!;
  assert.deepEqual(full.bloom, POST_DEFAULTS.bloom);
  assert.equal(postPlan(resolvePost({bloom: false}), 'full')!.bloom, null);
  assert.deepEqual(
    [
      postDrawsOf(null),
      postDrawsOf(basic),
      postDrawsOf(full),
      postDrawsOf(postPlan(resolvePost({bloom: false}), 'full')),
    ],
    [0, 1, 10, 1],
    'postDraws per rendered frame: 1 combined pass; bloom adds a threshold pass and 4 down and 4 up',
  );
  assert.deepEqual(POST_DRAWS, {off: 0, basic: 1, full: 10});
  assert.equal(postKey(basic), postKey(postPlan(resolvePost({vignette: {amount: 0.4}}), 'basic')));
  assert.notEqual(postKey(basic), postKey(full));
  assert.equal(postKey(null), 'off');
});

test('bloom mips start at half resolution and target bytes are what the pipeline allocates', () => {
  assert.deepEqual(bloomSizes(1280, 800), [
    [640, 400],
    [320, 200],
    [160, 100],
    [80, 50],
    [40, 25],
  ]);
  assert.deepEqual(bloomSizes(3, 1).at(-1), [1, 1], 'never below one pixel');
  const px = 1280 * 800;
  assert.equal(postTargetBytes(false, 1280, 800, 0), px * 12, 'half-float colour and depth');
  assert.equal(postTargetBytes(false, 1280, 800, 4), px * 8 + px * 4 * 12, 'multisampled colour and depth');
  const mips = bloomSizes(1280, 800).reduce((sum, [w, h]) => sum + w * h * 8, 0);
  assert.equal(postTargetBytes(true, 1280, 800, 0), px * 12 + mips);
});

test('a lookup table and an HDR ceiling validate, naming the field; strength 0 asks for no table', () => {
  const r = resolvePost({grade: {lut: {file: 'luts/night.cube'}}, ceiling: 32});
  assert.deepEqual(r.grade.lut, {file: 'luts/night.cube', strength: 1});
  assert.equal(r.ceiling, 32);
  assert.equal(resolvePost({grade: {lut: {file: 'a.cube', strength: 0}}}).grade.lut, null);
  const plan = postPlan(r, 'basic')!;
  assert.equal(plan.grade.lut!.file, 'luts/night.cube', 'the table is drawn at basic');
  assert.equal(plan.ceiling, 32);
  assert.notEqual(postKey(plan), postKey(postPlan(resolvePost({ceiling: 64}), 'basic')));
  const bad: [unknown, RegExp][] = [
    [{ceiling: 0.5}, /view\.post\.ceiling must be a number from 1 to 65504/],
    [{ceiling: Infinity}, /view\.post\.ceiling/],
    [{grade: {lut: {file: 'luts/night.cube', strength: 2}}}, /grade\.lut\.strength must be a number from 0 to 1/],
    [{grade: {lut: {strength: 1}}}, /grade\.lut\.file must be a path under public\//],
    [{grade: {lut: {file: '../secret.cube'}}}, /grade\.lut\.file/],
    [{grade: {lut: {file: 'https://x.test/a.cube'}}}, /grade\.lut\.file/],
    [{grade: {lut: {file: '/luts/a.cube'}}}, /grade\.lut\.file/],
    [{grade: {lut: {file: 'luts//a.cube'}}}, /grade\.lut\.file/],
    [{grade: {lut: {file: 'luts/a.png'}}}, /grade\.lut\.file/],
    [{grade: {lut: {file: 'a.cube', size: 33}}}, /grade\.lut\.size is unknown/],
  ];
  for (const [settings, re] of bad) assert.throws(() => resolvePost(settings as PostSettings), re);
});
