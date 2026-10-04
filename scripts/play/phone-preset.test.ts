// C6 (2026-10-03 acceptance): play:snap --mobile showed the reference picture, which no phone starts on. Its default
// phone preset must stay what the device-class start rule (ADR 0079) gives a minimum-class phone.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deviceClassCap} from '../../src/platform/render/quality';
import {PHONE_PRESET, PRESETS, viewPreset} from './lib.mjs';

test('the phone default is the device-class rule for a minimum-class phone (4 GB, mobile GPU)', () => {
  const phone = {coarsePointer: true, gpu: 'Mali-G68 MC4', deviceMemory: 4, cores: 8, maxTextureSize: 8192};
  assert.equal(deviceClassCap(phone)?.preset, PHONE_PRESET);
  // The overrides the summary names: a capable phone starts on high, an entry-level one on low.
  assert.equal(deviceClassCap({...phone, deviceMemory: 8})?.preset, 'high');
  assert.equal(deviceClassCap({...phone, gpu: 'Mali-G52'})?.preset, 'low');
});

test('--mobile pins the phone default; --quality pins every view; the desktop view is unpinned by default', () => {
  assert.equal(viewPreset('mobile', undefined), PHONE_PRESET);
  assert.equal(viewPreset('desktop', undefined), null);
  for (const p of PRESETS) {
    assert.equal(viewPreset('mobile', p), p);
    assert.equal(viewPreset('desktop', p), p);
  }
  assert.throws(() => viewPreset('mobile', 'ultra'), /--quality must be one of reference, high, medium, low/);
});
