import assert from 'node:assert/strict';
import {test} from 'node:test';
import {approveClip, approveRig, status, unfreeze} from './review.mjs';

const RIG = 'a'.repeat(64);
const fresh = () => ({schema: 1, rig: {status: 'pending'}, clips: {}, history: []});
const manifest = (hashes, rig = RIG) => ({
  rigSha256: rig,
  clips: Object.entries(hashes).map(([name, sampleSha256]) => ({name, sampleSha256})),
});

test('the rig gate comes first and refuses a test-pose report with weight problems', () => {
  assert.throws(() => approveClip(fresh(), manifest({walk: 'w1'}), 'walk', 'Ada'), /rig test poses before any clip/);
  assert.throws(
    () => approveRig(fresh(), {rigSha256: RIG, problems: ['3 vertices have no weights']}, 'Ada'),
    /no weights/,
  );
  assert.throws(() => approveRig(fresh(), {rigSha256: RIG, problems: []}, ''), /--by/);
  const review = approveRig(fresh(), {rigSha256: RIG, problems: [], sheet: 'testposes.png'}, 'Ada');
  assert.equal(review.rig.status, 'approved');
  assert.equal(review.rig.sha256, RIG);
});

test('an approved clip is frozen at its sample hash; a changed export shows, and unfreezing is explicit', () => {
  const review = approveRig(fresh(), {rigSha256: RIG, problems: []}, 'Ada');
  assert.throws(() => approveClip(review, manifest({walk: 'w1'}, 'b'.repeat(64)), 'walk', 'Ada'), /different rig/);
  approveClip(review, manifest({walk: 'w1'}), 'walk', 'Ada');
  assert.throws(() => approveClip(review, manifest({walk: 'w1'}), 'walk', 'Ada'), /already approved/);
  assert.deepEqual(status(review, manifest({walk: 'w1', wave: 'v1'})).clips, {walk: 'approved', wave: 'draft'});
  assert.deepEqual(status(review, manifest({walk: 'w2'})).clips, {walk: 'approved-but-changed'});
  assert.throws(() => unfreeze(review, 'walk', 'Ada'), /--reason/);
  unfreeze(review, 'walk', 'Ada', 'longer stride requested');
  assert.equal(review.clips.walk.status, 'unfrozen');
  assert.deepEqual(
    review.history.map(h => h.action),
    ['approve-rig', 'approve-clip', 'unfreeze'],
  );
});
