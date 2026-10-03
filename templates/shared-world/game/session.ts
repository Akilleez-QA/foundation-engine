// The shared rules, written once. The world scene imports them to play locally and to predict your own moves;
// `npm run host` imports the same file and applies them authoritatively for every player. Keep them pure: no clock,
// no random, no ECS. A world is entity id -> JSON fields; here each player is `p1`..`p4` and the painted floor is `board`.
import {defineSessionRules, integrityRules, type SessionIntegrityState, type SessionWorld} from '@kits/network';

/** Cells per side of the square board. */
export const SIZE = 7;
/** One color per player slot, in join order. */
export const COLORS = [0x4f8cff, 0xff8a3d, 0x52d273, 0xe85dd8] as const;
const SPAWNS: readonly (readonly [number, number])[] = [
  [0, 0],
  [SIZE - 1, SIZE - 1],
  [0, SIZE - 1],
  [SIZE - 1, 0],
];

export type Avatar = {readonly x: number; readonly z: number; readonly color: number};
/** 0 is bare floor; n is painted with color n - 1. */
export type Board = {readonly cells: readonly number[]};
export type Action = {readonly type: 'step'; readonly dx: number; readonly dz: number} | {readonly type: 'paint'};

const unit = (n: unknown) => n === -1 || n === 0 || n === 1;
const isAction = (value: unknown): value is Action => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>,
    keys = Object.keys(a).sort().join();
  if (a.type === 'paint') return keys === 'type';
  return a.type === 'step' && keys === 'dx,dz,type' && unit(a.dx) && unit(a.dz) && (a.dx !== 0 || a.dz !== 0);
};
export const isAvatar = (value: unknown): value is Avatar =>
  value !== null &&
  typeof value === 'object' &&
  Number.isInteger((value as Avatar).x) &&
  Number.isInteger((value as Avatar).z);
const clamp = (n: number) => Math.min(SIZE - 1, Math.max(0, n));
const board = (world: SessionWorld): Board => world.board as Board;

export default defineSessionRules<Action>({
  id: 'shared-world',
  version: 1,
  maxPlayers: COLORS.length,
  initial: () => ({board: {cells: Array(SIZE * SIZE).fill(0)}}),
  join(world, player) {
    const taken = new Set(
      Object.values(world)
        .filter(isAvatar)
        .map(a => a.color),
    );
    const color = COLORS.findIndex((_, i) => !taken.has(i));
    const [x, z] = SPAWNS[color]!;
    return {...world, [player]: {x, z, color}};
  },
  // The player's avatar goes; what they painted stays in the shared world.
  leave: (world, player) => Object.fromEntries(Object.entries(world).filter(([id]) => id !== player)),
  action: isAction,
  apply(world, player, action) {
    const me = world[player];
    if (!isAvatar(me)) return world;
    if (action.type === 'step') {
      const x = clamp(me.x + action.dx),
        z = clamp(me.z + action.dz);
      return x === me.x && z === me.z ? world : {...world, [player]: {...me, x, z}};
    }
    const cells = [...board(world).cells],
      i = me.z * SIZE + me.x,
      mark = me.color + 1;
    cells[i] = cells[i] === mark ? 0 : mark;
    return {...world, board: {cells}};
  },
  // Host-side plausibility (observe-only by default): at most one action per host tick (50 ms). The scene sends a
  // step at most every 120 ms, so an honest player is flagged only when a paint lands in the same tick as a step.
  integrity: [
    integrityRules.cooldown<Action, SessionIntegrityState>({
      id: 'action-pace',
      lastTick: ({state}) => state.lastActionTick,
      cooldownTicks: 1,
    }),
  ],
});
