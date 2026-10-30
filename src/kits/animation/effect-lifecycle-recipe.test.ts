// The code of docs/recipes/test-effect-lifecycles.md, run headless (imports point at the author API and the animation
// kit's source instead of '@engine' and '@kits/animation'). The last test checks that every `recipe:begin`…`recipe:end`
// block still appears in the recipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { must } from '../../testing/must';
import { defineComponent, defineEmitter, defineEntity, defineScene, defineSystem, Emitter, Name, sceneParticles, testScene, Transform, type Entity, type World } from '../../author';
import { createMarkerTrack, defineMarkerClip } from './index';

// recipe:begin
/** Marker times come from the clip's handoff, in seconds: effects fire on markers, never on a timer of their own. */
export const castClip = defineMarkerClip({ id: 'cast', duration: 0.8, markers: [
  { id: 'windup', at: 0.05 }, { id: 'release', at: 0.4 }, { id: 'impact', at: 0.6 },
] });

/** An action playing on its owner: the clip time so far, its recipient, and whether it was cancelled. */
export const Cast = defineComponent('cast', { serial: 0, elapsed: 0, target: -1, cancelled: false });
/** A visual effect entity: who owns it, what it is, and (for a status effect) the seconds it has left. */
export const Effect = defineComponent('effect', { owner: -1, kind: '', remaining: 0 });

export const windupGlow = defineEntity({ id: 'windup-glow', components: [
  defineEmitter({ mode: 'continuous', rate: 40, max: 32, lifetime: [.2, .3], speed: [0, .3], spread: Math.PI,
    size: [.15, 0], color: [0x9fd8ff], opacity: [.8, 0], despawn: true }),
] });
export const impactSparks = defineEntity({ id: 'impact-sparks', components: [
  defineEmitter({ mode: 'burst', count: 24, max: 24, bursts: 1, lifetime: [.2, .4], speed: [2, 4], spread: Math.PI / 2,
    size: [.1, 0], color: [0xffffff, 0xffa040], opacity: [1, 0], despawn: true }),
] });
// recipe:end

// recipe:begin
/** The owner's effect of `kind`, if one is still playing. */
function effectOf(world: World, owner: Entity, kind: string): Entity | undefined {
  for (const [e, fx, em] of world.query(Effect, Emitter)) if (fx.owner === owner && fx.kind === kind && em.playing) return e;
  return undefined;
}

/** Stop an effect: it emits nothing more, its particles finish, then `despawn: true` removes it. */
function stop(world: World, e: Entity | undefined) {
  const em = e === undefined ? undefined : world.get(e, Emitter);
  if (em) em.playing = false;
}

/** Plays each Cast's clip and spawns effects on the markers it crosses this step. */
export const castMarkers = defineSystem({ id: 'cast-markers', run(ctx, dt) {
  for (const [owner, cast, at] of ctx.world.query(Cast, Transform)) {
    if (cast.cancelled) { stop(ctx.world, effectOf(ctx.world, owner, 'windup')); ctx.world.remove(owner, Cast); continue; }
    const track = createMarkerTrack(castClip, { action: `cast-${owner}-${cast.serial}` });
    track.seek(cast.elapsed);
    cast.elapsed = Math.min(castClip.duration, cast.elapsed + dt);
    for (const marker of track.advance(cast.elapsed)) {
      if (marker.marker === 'windup')
        ctx.spawn(windupGlow, Transform({ x: at.x, y: at.y + 1, z: at.z }), Effect({ owner, kind: 'windup', remaining: 0 }));
      else if (marker.marker === 'release') stop(ctx.world, effectOf(ctx.world, owner, 'windup'));
      else if (marker.marker === 'impact') {
        const hit = ctx.world.get(cast.target, Transform);
        if (!hit) continue; // the recipient is gone: no impact
        ctx.spawn(impactSparks, Transform({ x: hit.x, y: hit.y + 1, z: hit.z }));
        ctx.play('impact');
      }
    }
    if (cast.elapsed >= castClip.duration) ctx.world.remove(owner, Cast);
  }
} });

/** Effects follow their owner; an owner that is gone, or a status that ran out, stops its effect. */
export const followOwners = defineSystem({ id: 'follow-owners', run(ctx, dt) {
  for (const [, fx, tr, em] of ctx.world.query(Effect, Transform, Emitter)) {
    if (!em.playing) continue;
    const owner = ctx.world.get(fx.owner, Transform);
    if (!owner) { em.playing = false; continue; }
    tr.x = owner.x; tr.y = owner.y + 1; tr.z = owner.z;
    if (fx.kind === 'aura' && (fx.remaining -= dt) <= 0) em.playing = false;
  }
} });
// recipe:end

// recipe:begin
/** Start a cast; cancel it with `world.get(owner, Cast)!.cancelled = true` before its release marker. */
export function startCast(world: World, owner: Entity, target: Entity, serial: number) {
  world.add(owner, Cast({ serial, elapsed: 0, target, cancelled: false }));
}

/** A status effect's motes. A function, so each aura gets its own data (`world.spawn` keeps the value it is given). */
const auraMotes = () => defineEmitter({ mode: 'continuous', rate: 20, max: 24, lifetime: [.5, .8], speed: [.1, .3],
  spread: Math.PI, size: [.08, 0], color: [0xb0ff9a], opacity: [.7, 0], despawn: true });

/** Apply (or refresh) a status effect: one aura per recipient, however often it is applied. */
export function applyAura(world: World, target: Entity, seconds: number) {
  const current = effectOf(world, target, 'aura');
  if (current !== undefined) { world.get(current, Effect)!.remaining = seconds; return current; }
  const at = world.get(target, Transform)!;
  return world.spawn(auraMotes(), Transform({ x: at.x, y: at.y + 1, z: at.z }),
    Effect({ owner: target, kind: 'aura', remaining: seconds }));
}

/** A pooled trail: a new component on each use restarts the emitter where it now is, with no old particles. */
const trailEmitter = () => defineEmitter({ mode: 'continuous', rate: 60, max: 48, lifetime: [.3, .4], speed: [0, .1],
  spread: Math.PI, size: [.12, 0], color: [0xffe08a], opacity: [.8, 0] });
export function useTrail(world: World, trail: Entity, x: number, y: number, z: number) {
  Object.assign(world.get(trail, Transform)!, { x, y, z });
  world.add(trail, trailEmitter());
}
export function releaseTrail(world: World, trail: Entity) {
  world.get(trail, Emitter)!.playing = false;
}
// recipe:end

const arena = () => defineScene({ id: 'effects', title: 'Effects', particles: sceneParticles(),
  entities: [[Name({ name: 'caster' }), Transform()], [Name({ name: 'recipient' }), Transform({ x: 4 })],
    [Name({ name: 'trail' }), Transform(), defineEmitter({ mode: 'continuous', playing: false, max: 48 })]],
  systems: [castMarkers, followOwners] });

// recipe:begin
const count = (world: World, kind: string) => [...world.query(Effect)].filter(([, fx]) => fx.kind === kind).length;
const impacts = (t: { plays: { id: string }[] }) => t.plays.filter(p => p.id === 'impact').length;

test('a cancelled windup produces nothing: no impact, no sound, and its glow stops', async () => {
  const t = await testScene(arena(), { seed: 1, sounds: ['impact'] });
  const caster = t.ctx.named('caster')!, recipient = t.ctx.named('recipient')!;
  startCast(t.world, caster, recipient, 1);
  t.run(0.2);                                   // past the windup marker, before release
  const glow = effectOf(t.world, caster, 'windup')!;
  assert.ok(t.particles.sample(glow)!.live > 0, 'the windup glows');
  t.world.get(caster, Cast)!.cancelled = true;
  t.run(2);                                     // long past where release and impact would have been
  assert.equal(impacts(t), 0);
  assert.equal(t.ctx.world.exists(glow), false, 'the glow finished and removed itself');
  assert.equal(t.particles.stats!.live, 0);
  t.dispose();
});

test('an impact fires exactly once, on its marker, at the recipient', async () => {
  const t = await testScene(arena(), { seed: 1, sounds: ['impact'] });
  const caster = t.ctx.named('caster')!, recipient = t.ctx.named('recipient')!;
  startCast(t.world, caster, recipient, 1);
  t.run(0.55);
  assert.equal(impacts(t), 0, 'not before the impact marker');
  const before = t.particles.stats!.spawned;
  t.run(0.1);
  assert.equal(impacts(t), 1);
  assert.equal(t.particles.stats!.spawned - before, 24, 'one burst of sparks and nothing else');
  const sparks = [...t.world.query(Emitter, Transform)].find(([, em]) => em.count === 24)!;
  assert.equal(sparks[2].x, 4, 'at the recipient');
  t.run(2);
  assert.equal(impacts(t), 1, 'still once after the clip has ended');
  t.dispose();
});

test('stacking refreshes instead of duplicating: one aura however often it is applied', async () => {
  const t = await testScene(arena(), { seed: 1 });
  const recipient = t.ctx.named('recipient')!;
  const first = applyAura(t.world, recipient, 1);
  t.run(0.6);
  assert.equal(applyAura(t.world, recipient, 1), first);
  assert.equal(applyAura(t.world, recipient, 1), first);
  assert.equal(count(t.world, 'aura'), 1);
  t.run(0.6);                                   // 1.2 s after the first application: refreshed, still playing
  assert.equal(t.world.get(first, Emitter)!.playing, true);
  t.run(2);
  assert.equal(count(t.world, 'aura'), 0, 'expired once, then removed itself');
  t.dispose();
});

test('an owner despawn stops emission: no new particles, then the effect is gone', async () => {
  const t = await testScene(arena(), { seed: 1 });
  const recipient = t.ctx.named('recipient')!;
  const aura = applyAura(t.world, recipient, 10);
  t.run(0.5);
  t.world.despawn(recipient);
  t.run(1 / 60);
  const spawned = t.particles.sample(aura)!.spawned;
  t.run(0.3);
  assert.equal(t.particles.sample(aura)?.spawned ?? spawned, spawned, 'nothing emitted after the owner left');
  t.run(1);
  assert.equal(t.world.exists(aura), false);
  assert.equal(t.particles.stats!.live, 0);
  t.dispose();
});

test('pooled trails do not bridge between uses: a reused trail starts fresh where it now is', async () => {
  const t = await testScene(arena(), { seed: 1 });
  const trail = t.ctx.named('trail')!;
  useTrail(t.world, trail, -10, 0, 0);
  t.run(0.5);
  releaseTrail(t.world, trail);
  useTrail(t.world, trail, 10, 0, 0);          // straight away: the old particles are still alive
  t.run(1 / 60);
  const fresh = t.particles.sample(trail)!;
  assert.ok(fresh.live > 0);
  assert.ok(fresh.bounds!.min[0] > 9, `no particle between the two uses (min x ${fresh.bounds!.min[0]})`);
  t.dispose();
});
// recipe:end

test('without a new component, a moved trail bridges: the check above can fail', async () => {
  const t = await testScene(arena(), { seed: 1 });
  const trail = t.ctx.named('trail')!;
  useTrail(t.world, trail, -10, 0, 0);
  t.run(0.5);
  Object.assign(t.world.get(trail, Transform)!, { x: 10 }); // moved, not restarted
  t.run(1 / 60);
  assert.ok(t.particles.sample(trail)!.bounds!.min[0] < 0, 'old and in-between particles remain');
  t.dispose();
});

test('particles.sample is null for an entity without an admitted emitter', async () => {
  const t = await testScene(arena(), { seed: 1 });
  assert.equal(t.particles.sample(must(t.ctx.named('caster'), 'caster')), null);
  t.dispose();
});

test("recipe: the definitions above are the recipe's code", () => {
  const norm = (code: string) => code.replace(/\/\/[^\n]*/g, '').replace(/\bexport\b/g, '').replace(/[\s;,]/g, '');
  const recipe = readFileSync(new URL('../../../docs/recipes/test-effect-lifecycles.md', import.meta.url), 'utf8');
  const code = norm([...recipe.matchAll(/```ts\n([\s\S]*?)```/g)].map(m => m[1]).join('\n'));
  const own = readFileSync(new URL(import.meta.url), 'utf8');
  const blocks = [...own.matchAll(/\/\/ recipe:begin\n([\s\S]*?)\/\/ recipe:end/g)].map(m => must(m[1], 'recipe block'));
  assert.equal(blocks.length, 4);
  for (const block of blocks) assert.ok(code.includes(norm(block)), `not in the recipe:\n${block}`);
});
