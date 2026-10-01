import { labSave, bagOptions } from './save';
import { createStructure } from '@kits/housing';
import { type SceneContext, Transform, Shape, Model } from '@engine';
import { applyRootMotion } from '@kits/locomotion';
import { createRootMotion, blendPoseLayers, solveTwoBone } from '@kits/animation';
import { createControl } from '@kits/control';
import { resetCharacterMotion } from '@kits/character';
import { createFrames } from '@kits/frames';
import { createVehicles, boardVehicle, exitVehicle, vehicleRiderSystem } from '@kits/vehicles';
import { createSocketRig, createMarkerTrack, createPoseSampler } from '@kits/animation';
import { createMarket } from '@kits/market';
import { createCheckpointInventory } from '@kits/inventory';
import { createEquipment } from '@kits/equipment';
import { createCapabilities } from '@kits/capabilities';
import { createShots, resolveAction, sweep } from '@kits/combat';
export const matrix = (x: number, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export function createSession(ctx: SceneContext) {
  const owner = createControl({ owner: 'character', target: 'player', frame: { id: 'lab', generation: 1 } }, { input: { cancel: reason => ctx.service('input').cancel(reason) }, resetMotion: () => resetCharacterMotion(ctx.world, ctx.named('player')) });
  const beaconOwner = createControl({ owner: 'animation', target: 'beacon', frame: { id: 'lab', generation: 1 } }, { input: { cancel: reason => ctx.service('input').cancel(reason) }, resetMotion() {} });
  const rootMotion = createRootMotion({ duration: 2, keys: [{ at: 0, x: 0, z: 0, yaw: 0 }, { at: 2, x: 1.2, z: 0, yaw: 0 }] });
  const frames = createFrames(), frame = { id: 'platform', generation: 1 };
  frames.set({ ...frame, matrix: matrix(-3, .2, 0) });
  const fleet = createVehicles(frames); fleet.register('platform', frame, [{ id: 'only', sockets: { seat: matrix(0, .5, 0) } }], 'only');
  const saved = ctx.save(labSave).get();
  let store = createMarket(saved.market);
  let bag = createCheckpointInventory(bagOptions, saved.bag);
  const property = createStructure({ revision: 0, owner: 'player', grants: {}, placements: [], occupants: [], packed: false });
  let gear: ReturnType<typeof createEquipment> | null = null;
  const riderSystem = vehicleRiderSystem(fleet);
  const abilities = createCapabilities([{ id: 'probe', requires: [], evidence: ['equipped'] }]);
  const hand = createSocketRig([{ id: 'only', sockets: { hand: matrix(.5) } }]);
  hand.attach('probe-model', 'hand');
  const probePose = createPoseSampler({ id: 'probe-pulse', duration: .5, tracks: [{ joint: 'hand', keys: [
    { at: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    { at: .25, position: [0, .3, 0], rotation: [0, 0, 0, 1] },
    { at: .5, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  ] }] });
  const shots = createShots(4); let track: ReturnType<typeof createMarkerTrack> | null = null, started = 0;
  let phase = 0, tags = 0, markers = 0, flashUntil = 0;
  const claim = () => {
    // Stage both ledgers before publishing either, so capacity failure cannot lose the claim.
    const marketCopy = createMarket(store.snapshot());
    const bagCopy = createCheckpointInventory(bagOptions, bag.snapshot());
    const purchase = marketCopy.purchase({ id: 'lab-delivery', offer: 'probe', revision: 1, buyer: 'player', quantity: 1 }, 0);
    if (!purchase.ok || purchase.claim.collected) return false;
    const delivered = marketCopy.collect('lab-delivery', 'player', 1); if (!delivered) return false;
    const added = bagCopy.apply(bagCopy.epoch, { kind: 'exchange', id: 'lab-delivery', consume: [], produce: [{ container: 'bag', batch: { id: 'probe-batch', material: 'probe', properties: {} }, quantity: 1 }] });
    if (!added.ok) return false; bagCopy.checkpoint();
    ctx.save(labSave).update(d => { d.bag = bagCopy.snapshot(); d.market = marketCopy.snapshot(); });
    store = marketCopy; bag = bagCopy; gear = createEquipment(['hand'], 1, { revision: 0, items: [{ id: 'probe-1', definition: 'probe', slots: ['hand'], functional: true }], equipped: [] }); return true;
  };
  const canProbe = () => abilities.has('probe') && Boolean(gear?.active().some(item => item.id === 'probe-1'));
  return {
    frames, fleet, beaconOwner, claim, canProbe, riderSystem, owner, property,
    snapshot: () => ({ phase, tags, markers, balance: store.balance('player'), bag: bag.snapshot(), equipped: gear?.active().length ?? 0 }),
    next(ctx: SceneContext) {
      const player = ctx.named('player')!;
      if (phase === 0) { if (owner.transition({ owner: 'vehicle', target: 'player', frame }, () => boardVehicle(ctx, player, fleet, 'platform', 'seat'))) phase = 1; }
      else if (phase === 1) {
        const pose = fleet.pose('player'); if (pose && owner.transition({ owner: 'character', target: 'player', frame: { id: 'lab', generation: 1 } }, () => exitVehicle(ctx, player, fleet, matrix(pose[12], .7, 2), p => Math.abs(p[12]) < 7 && Math.abs(p[14]) < 5))) phase = 2;
      } else if (phase === 2) {
        if (claim() || bag.quantity('bag', 'probe-batch') === 1) { gear ??= createEquipment(['hand'], 1, { revision: 0, items: [{ id: 'probe-1', definition: 'probe', slots: ['hand'], functional: true }], equipped: [] }); phase = 3; }
      }
      else if (phase === 3 && gear) { gear.commit('probe-1', gear.snapshot().revision); abilities.record('equipped'); abilities.grant({ capability: 'probe', reason: 'earned', event: 'lab-equipped' }); phase = 4; }
      else if (phase === 4 && canProbe() && !track) {
        started = ctx.time.t; shots.launch('probe-shot', 'player', started + 2);
        track = createMarkerTrack({ id: 'probe-use', duration: .5, markers: [{ id: 'contact', at: .25 }] }, { action: 'probe-shot' });
      } else if (phase === 5) {
        if (property.place('player', { id: 'station', x: 0, z: 2, width: 1, depth: 1, height: 0 }, property.snapshot().revision, (x, z) => ({ height: 0, excluded: Math.abs(x) > 8 || Math.abs(z) > 6 }))) { property.enter('player'); phase = 6; }
      } else if (phase === 6) { property.leave('player'); phase = 7; }
      else if (phase === 7) { if (property.pack('player', property.snapshot().revision)) phase = 8; }
      else if (phase === 8) ctx.scene.restart();
    },
    update(ctx: SceneContext, dt: number) {
      const beaconEntity = ctx.named('beacon')!;
      applyRootMotion(ctx, beaconEntity, rootMotion.advance(ctx.time.t), { owns: () => beaconOwner.owns('animation', 'beacon'), radius: .15 });
      const ik = solveTwoBone([0, 0, 0], [.7, .6, Math.sin(ctx.time.t) * .25], [0, 0, 1], .6, .6);
      const mixed = blendPoseLayers([
        { joint: 'shoulder', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { joint: 'elbow', position: [0, .6, 0], rotation: [0, 0, 0, 1] },
      ], [{ mask: ['shoulder', 'elbow'], weight: .8, pose: [
        { joint: 'shoulder', position: [0, 0, 0], rotation: ik.shoulderRotation },
        { joint: 'elbow', position: [0, .6, 0], rotation: ik.elbowRotation },
      ] }]);
      ctx.world.get(beaconEntity, Model)!.pose = mixed.map(p => ({ node: p.joint, rotation: p.rotation }));
      const platform = ctx.world.get(ctx.named('platform')!, Transform)!;
      if (fleet.hasRider('player')) { platform.x = -3 + Math.sin(ctx.time.t) * 1.25; frames.set({ ...frame, matrix: matrix(platform.x, .2, 0) }); }
      const target = ctx.world.get(ctx.named('target')!, Transform)!, previous = target.z; target.z = -1 + Math.sin(ctx.time.t * 1.3) * .6;
      if (track) for (const marker of track.advance(Math.max(0, ctx.time.t - started))) if (marker.marker === 'contact') markers++;
      // Simulation action timing owns the result; presentation markers only report their crossing.
      if (track && ctx.time.t - started >= .25 && shots.status('probe-shot') === 'active') {
        const hit = sweep([0, 1, previous], [6, 1, target.z], .15, [{ id: 'target', from: [4, 1, previous], to: [4, 1, target.z], radius: .45 }]);
        resolveAction({ id: 'probe-shot', target: 'target', amount: 1 }, { eligible: canProbe, hit: () => hit !== null, mitigate: n => n, commit: result => {
          if (!shots.resolve(result.id, ctx.time.t)) return false;
          if (result.hit) { tags++; phase = 5; flashUntil = ctx.time.t + .5; ctx.playVoice('ui.success', { spatial: { position: hit!.point, refDistance: 4, maxDistance: 60, rolloffFactor: .5 } }); } return true;
        } });
      }
      const tool = ctx.world.get(ctx.named('probe')!, Transform)!, player = ctx.world.get(ctx.named('player')!, Transform)!;
      const localPose = probePose.sample(track ? Math.max(0, ctx.time.t - started) : 0)[0];
      const handPose = hand.sample('probe-model', 'only', { id: 'lab', matrix: matrix(player.x, player.y, player.z) }).matrix;
      tool.x = handPose[12]; tool.y = handPose[13] + localPose.position[1]; tool.z = handPose[14];
      ctx.world.get(ctx.named('probe')!, Shape)!.visible = canProbe();
      ctx.world.get(ctx.named('beam')!, Shape)!.visible = ctx.time.t < flashUntil;
      ctx.world.get(ctx.named('kiosk')!, Shape)!.visible = !property.snapshot().packed;
      const beacon = ctx.modelSocket(ctx.named('beacon')!, 'hand');
      ctx.state.model = { ready: beacon !== null, socketY: beacon?.matrix[13] ?? null };
      ctx.state.lab = this.snapshot(); ctx.world.touch(); void dt;
    },
    dispose() { beaconOwner.dispose(); owner.dispose(); track?.cancel(); shots.cancelOwner('player'); hand.clear(); },
    label: () => ['lab.ride', 'lab.exit', 'lab.claim', 'lab.equip', 'lab.fire', 'lab.place', 'lab.leave', 'lab.pack', 'lab.reset'][phase],
    status: () => track && phase === 4 ? 'lab.wait' : ['lab.intro', 'lab.riding', 'lab.exited', 'lab.claimed', 'lab.equipped', 'lab.tagged', 'lab.occupied', 'lab.vacant', 'lab.packed'][phase],
  };
}
export type LabSession = ReturnType<typeof createSession>;
