/**
 * kits/explore: move-and-interact. Things in a scene carry `Interactable`; when the player (the entity named
 * 'player') is within reach of one, the HUD prompt shows its label and the kit's `explore-interact` action (E,
 * Enter, Space, pad A, or a tap) uses it:
 *   - the world event 'interact' ({ id }) fires, for the game's own systems to react;
 *   - the use is remembered in the save section `explore.progress` (per scene and id, never forgotten);
 *   - a door (`to: '<scene>'`) goes to that scene, arriving at (`toX`, `toZ`) through the scene parameters.
 * Scenes are rooms, levels or areas: whatever the game calls them. Checkpoints: `explore.progress.visited` lists
 * the scenes entered, `last` the last door taken.
 *
 * Needs the ui kit (prompt) and usually the character kit (movement). Cost: one pass over interactables per fixed
 * step; no draws of its own.
 */
import { defineComponent, defineInput, defineKit, defineSaveSection, defineSystem, Transform, type KitDefinition, type SceneContext, type SystemDefinition } from '../../author';
import { hud } from '../ui';

/** Something the player can use. `label` is a string key; `to` (a scene id) makes it a door. */
export const Interactable = defineComponent('interactable', { id: '', label: '', reach: 1.5, to: '', toX: 0, toZ: 0 });

export const interact = defineInput({ id: 'explore-interact', label: 'Use', keys: ['e', 'Enter', 'Space'], pad: ['a'], tap: true });

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].sort();
export const progress = defineSaveSection({
  id: 'explore.progress',
  initial: { used: [] as string[], visited: [] as string[], last: '' },
  merge: (a, b) => ({ used: union(a.used, b.used), visited: union(a.visited, b.visited), last: b.last || a.last }),
});

/** The interactable nearest the player within its reach, or null. */
export function nearest(ctx: SceneContext, player = 'player'): { id: string; label: string; to: string; toX: number; toZ: number } | null {
  const e = ctx.named(player), me = e === undefined ? undefined : ctx.world.get(e, Transform);
  if (!me) return null;
  let best: ReturnType<typeof nearest> = null, gap = Infinity;
  for (const [, tr, it] of ctx.world.query(Transform, Interactable)) {
    const d = Math.hypot(tr.x - me.x, tr.z - me.z);
    if (d <= it.reach && d < gap) { gap = d; best = it; }
  }
  return best;
}

export interface ExploreOptions {
  player?: string;
  /** The prompt for a thing (default: its label's text). */
  prompt?: (ctx: SceneContext, label: string) => string;
  when?: (ctx: SceneContext) => boolean;
}

export function exploreSystem(o: ExploreOptions = {}): SystemDefinition {
  return defineSystem({
    id: 'explore-interact',
    run(ctx) {
      const save = ctx.save(progress);
      if (!ctx.state.exploreReady) {
        ctx.state.exploreReady = true;
        if (!save.get().visited.includes(ctx.scene.id)) save.update(d => { d.visited = union(d.visited, [ctx.scene.id]); });
        const x = Number(ctx.scene.params.x), z = Number(ctx.scene.params.z), e = ctx.named(o.player ?? 'player');
        const tr = e === undefined ? undefined : ctx.world.get(e, Transform);
        if (tr && Number.isFinite(x) && Number.isFinite(z) && ctx.scene.params.x !== undefined) { tr.x = x; tr.z = z; }
      }
      if (o.when && !o.when(ctx)) { hud(ctx).prompt(null); return; }
      const near = nearest(ctx, o.player);
      ctx.state.near = near?.id ?? null;
      hud(ctx).prompt(near ? (o.prompt ? o.prompt(ctx, near.label) : ctx.text(near.label)) : null);
      if (!near || !ctx.input.pressed('explore-interact')) return;
      const key = `${ctx.scene.id}/${near.id}`;
      save.update(d => { if (!d.used.includes(key)) d.used = union(d.used, [key]); if (near.to) d.last = key; });
      ctx.world.emit('interact', { id: near.id });
      ctx.play('ui.click');
      if (near.to) ctx.scene.goto(near.to, { x: String(near.toX), z: String(near.toZ) });
    },
  });
}

/** How many of these `scene/id` keys the player has used. */
export function usedCount(ctx: SceneContext, keys: readonly string[]): number {
  const used = ctx.save(progress).get().used;
  return keys.filter(k => used.includes(k)).length;
}

/** The kit: the interact action and the progress section. Needs the ui kit. */
export function explore(): KitDefinition { return defineKit({ id: 'explore', requires: ['ui'], defs: [interact, progress] }); }
