/**
 * author/input-registry.ts: the boot-time `inputActions` check, run in Node over a game's definitions.
 *
 * At boot `platform.input` registers the engine's own rows (Back, pause, mute, focus, the shell menu) and `feature.game`
 * registers one row per button and two per axis (compile.ts `actionRows`, kit inputs included). The registry then runs
 * its `validate` and `problems` (the reach check and overlapping default bindings), and any problem stops the boot.
 * `gameInputProblems` builds the same table with the same registry options, so `npm run check` (lint:brief) reports
 * a clash before a browser does. `freeButtonBinding` / `freeAxisBinding` let the input generator choose defaults that
 * pass that same check.
 *
 * Owner: the author layer (read-only view of the platform rows). No browser, clock or I/O.
 * Limits: like the boot check, a key matched by `key` ('f') and one matched by `code` ('code:KeyF') are different
 * chords here; the generator treats them as the same letter when it chooses a free key.
 */
import { adminOf } from '../core/registry';
import { bindingConflicts, CORE_INPUT_ACTIONS, defineInputActions, type InputActionDef, type KeyChord, type PadInput } from '../platform/input/actions';
import { actionRows, allDefinitions, GAME_MODULE_ID } from './compile';
import type { AuthorDef, GameDefinition, InputDefinition } from './defs';

/** platform/input/module.ts INPUT_MODULE_ID (not imported: that module pulls in the DOM runtime). */
const INPUT_MODULE_ID = 'platform.input';

/** The `inputActions` rows a game boots with: the engine's rows, then the game's and its kits' inputs. */
export function gameInputRows(game: GameDefinition, defs: readonly (AuthorDef | undefined)[]): { row: InputActionDef; source: string }[] {
  const inputs = allDefinitions(game, defs).filter((d): d is InputDefinition => d.kind === 'input');
  return [
    ...CORE_INPUT_ACTIONS.map(row => ({ row, source: INPUT_MODULE_ID })),
    ...inputs.flatMap(i => actionRows(i).map(row => ({ row, source: GAME_MODULE_ID }))),
  ];
}

/** Problems the boot's `inputActions` validation would report, as '<registry>[<row>] (from <module>): <problem>'. */
export function inputRowProblems(rows: readonly { row: InputActionDef; source: string }[]): string[] {
  const registry = defineInputActions(), out: string[] = [];
  for (const { row, source } of rows) {
    try { registry.add(row, source); } catch (e) { out.push(`inputActions[${row.id}] (from ${source}): ${(e as Error).message}`); }
  }
  for (const p of adminOf(registry).check('report')) {
    out.push(`${p.registry}${p.id ? `[${p.id}]` : ''}${p.source ? ` (from ${p.source})` : ''}: ${p.problem}`);
  }
  return out;
}

/** The problems a game's inputs would stop the boot with (empty when the table is valid). */
export function gameInputProblems(game: GameDefinition, defs: readonly (AuthorDef | undefined)[]): string[] {
  return inputRowProblems(gameInputRows(game, defs));
}

/** Keys the generator offers, in order: letters away from the usual movement and engine keys first. */
const KEY_CANDIDATES: readonly KeyChord[] = ['f', 'r', 'g', 't', 'c', 'v', 'x', 'z', 'h', 'j', 'k', 'l', 'y', 'u', 'i', 'o', 'n', 'b', 'q', 'e', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** Pad buttons the generator offers for a button, in order: free face and shoulder buttons first. */
const PAD_CANDIDATES: readonly PadInput[] = ['y', 'a', 'rb', 'lb', 'rt', 'lt', 'r3', 'l3', 'dpad-left', 'dpad-right', 'dpad-up', 'dpad-down', 'view', 'x', 'b'];
const AXIS_KEY_PAIRS: readonly (readonly [KeyChord, KeyChord])[] = [['code:KeyQ', 'code:KeyE'], ['code:KeyZ', 'code:KeyC'], ['code:KeyR', 'code:KeyF'], ['code:KeyG', 'code:KeyH'], ['code:KeyJ', 'code:KeyL'], ['code:Digit1', 'code:Digit2']];
const AXIS_PAD_PAIRS: readonly (readonly [PadInput, PadInput])[] = [['lb', 'rb'], ['lt', 'rt'], ['rs-left', 'rs-right'], ['rs-up', 'rs-down'], ['ls-left', 'ls-right'], ['ls-up', 'ls-down'], ['dpad-left', 'dpad-right'], ['dpad-up', 'dpad-down'], ['l3', 'r3'], ['x', 'b']];

/** The letter or name a chord presses, so 'f', 'F' and 'code:KeyF' count as one key when choosing a free one. */
export function keyIdentity(chord: KeyChord): string {
  const base = chord.split('+').pop()!;
  const code = /^code:(?:Key([A-Z])|Digit(\d)|(.+))$/.exec(base);
  return code ? (code[1] ?? code[2] ?? code[3]).toLowerCase() : base.toLowerCase();
}

function usedBy(rows: readonly { row: InputActionDef }[]) {
  const keys = new Set<string>(), pad = new Set<string>();
  for (const { row } of rows) {
    for (const k of row.defaults.keys ?? []) keys.add(keyIdentity(k));
    for (const p of row.defaults.pad ?? []) pad.add(p);
  }
  return { keys, pad };
}

/**
 * Picks the first candidate whose rows add no overlapping binding (the boot check's `bindingConflicts`), preferring
 * inputs no row uses at all, then inputs only a layer row owns (a 'layer' row over a 'global' one is ownership by
 * design, not a clash).
 */
function pick<T>(base: readonly { row: InputActionDef }[], candidates: readonly T[], unused: (c: T) => boolean, rowsOf: (c: T) => InputActionDef[]): T | undefined {
  const rows = base.map(b => b.row), before = new Set(bindingConflicts(rows));
  const ok = (c: T) => bindingConflicts([...rows, ...rowsOf(c)]).every(p => before.has(p));
  return candidates.find(c => unused(c) && ok(c)) ?? candidates.find(ok);
}

const probe = (id: string, side?: 'neg' | 'pos'): Pick<InputActionDef, 'id' | 'label' | 'scope' | 'kind'> =>
  ({ id: `game.${id}${side ? '.' + side : ''}`, label: `game.input.${id}`, scope: 'global', kind: side ? 'hold' : 'press' });

/** A key and a pad button for a new button `id` that pass the boot check with the game's current inputs. */
export function freeButtonBinding(game: GameDefinition, defs: readonly (AuthorDef | undefined)[], id: string): { keys: KeyChord[]; pad: PadInput[] } {
  const base = gameInputRows(game, defs), used = usedBy(base);
  const key = pick(base, KEY_CANDIDATES, k => !used.keys.has(keyIdentity(k)), k => [{ ...probe(id), defaults: { keys: [k] } } as InputActionDef]);
  const pad = pick(base, PAD_CANDIDATES, p => !used.pad.has(p), p => [{ ...probe(id), defaults: { pad: [p] } } as InputActionDef]);
  if (!key || !pad) throw Error(`no free ${key ? 'pad button' : 'key'} is left for input '${id}'; choose its bindings by hand`);
  return { keys: [key], pad: [pad] };
}

/** Negative and positive keys and pad inputs for a new axis `id` that pass the boot check with the game's inputs. */
export function freeAxisBinding(game: GameDefinition, defs: readonly (AuthorDef | undefined)[], id: string): { negative: { keys: KeyChord[]; pad: PadInput[] }; positive: { keys: KeyChord[]; pad: PadInput[] } } {
  const base = gameInputRows(game, defs), used = usedBy(base);
  const rows = <T extends string>(pair: readonly [T, T], field: 'keys' | 'pad') =>
    (['neg', 'pos'] as const).map((side, i) => ({ ...probe(id, side), defaults: { [field]: [pair[i]] } } as InputActionDef));
  const keys = pick(base, AXIS_KEY_PAIRS, p => p.every(k => !used.keys.has(keyIdentity(k))), p => rows(p, 'keys'));
  const pad = pick(base, AXIS_PAD_PAIRS, p => p.every(b => !used.pad.has(b)), p => rows(p, 'pad'));
  if (!keys || !pad) throw Error(`no free ${keys ? 'pad pair' : 'key pair'} is left for axis '${id}'; choose its bindings by hand`);
  return { negative: { keys: [keys[0]], pad: [pad[0]] }, positive: { keys: [keys[1]], pad: [pad[1]] } };
}
