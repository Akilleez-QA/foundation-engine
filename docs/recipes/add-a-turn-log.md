# Recipe: add a deterministic turn log (undo, redo, preview, replay)

For games whose state advances by discrete player or AI commands: turn-based, tactics,
card, puzzle and board games, or any step-wise simulation. The optional
[`turns` kit](../../src/kits/turns/README.md) keeps the accepted commands and derives
every state by replaying them with a seeded random stream per command position. The
creator writes the rules; the kit supplies no turn order, phases, cards or AI.

## 1. Write the rules (pure)

```ts
// game/rules.ts
import { type TurnRules } from '@kits/turns';

export type Board = { tiles: number[]; turn: number };
export type Move = { type: 'swap'; a: number; b: number } | { type: 'scramble' };

export const rules: TurnRules<Board, Move> = {
  id: 'my-game-rules@1',            // bump it when behaviour changes
  validateState: (v): v is Board => /* shape check */ true,
  validateCommand: (v): v is Move => /* shape check */ true,
  reduce({ state, command, random }) {
    if (command.type === 'scramble') {
      const tiles = [...state.tiles];
      for (let i = tiles.length - 1; i > 0; i--) { const j = random.int(0, i); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
      return { accept: true, state: { tiles, turn: state.turn + 1 } };
    }
    if (command.a === command.b) return { accept: false, reason: 'same tile' };
    const tiles = [...state.tiles]; [tiles[command.a], tiles[command.b]] = [tiles[command.b], tiles[command.a]];
    return { accept: true, state: { tiles, turn: state.turn + 1 } };
  },
};
```

`state` arrives frozen: build a new value instead of mutating it. Use `random`, never
`Math.random` or the clock. Keep whose turn it is, phases and timers in the state.

## 2. Own one log per match

```ts
import { createTurnLog } from '@kits/turns';
const log = createTurnLog({
  rules, seed: 'run-42', initial: { tiles: [0, 1, 2, 3], turn: 0 },
  limits: { maxCommands: 256, state: { maxBytes: 16384, maxNodes: 1024, maxDepth: 8 },
            command: { maxBytes: 512, maxNodes: 16, maxDepth: 3 } },
});
const view = log.read();
const preview = log.preview({ type: 'scramble' });   // the exact outcome, nothing changes; preview.full warns at capacity
const result = log.submit(view.revision, { type: 'scramble' });
log.undo(log.read().revision); log.redo(log.read().revision);
log.replay(0);                                       // state at any retained step, for a replay view
log.dispose();                                       // when the match ends
```

Handle every status: `rejected` (rules said no), `invalid` (shape or limits), `stale`
(an older, missing or malformed `revision`), `full` (capacity: `checkpoint` folds history to continue),
`busy`, `retired`. Systems turn input actions into commands; render from `read().state`
only when `revision` changes.

## 3. Save and restore with a save section

```ts
import { defineSaveSection } from '@engine';
import { restoreTurnLog } from '@kits/turns';
export const match = defineSaveSection({ id: 'game.match', initial: { json: '' } });

ctx.save(match).update(d => { d.json = JSON.stringify(log.snapshot()); });
const saved = ctx.save(match).get().json;
let stored: unknown = null;
try { stored = saved ? JSON.parse(saved) : null; } catch { stored = undefined; } // corrupt text: treat as invalid
const restored = stored === null ? null : restoreTurnLog({ rules, limits }, stored);
// 'invalid' | 'foreign' | 'diverged': keep the saved value, tell the player, start a new run explicitly.
```

Never rename the section id. A rules change that alters outcomes needs a new `rules.id`
(old saves then report `foreign`) or a creator migration.

## 4. Multiplayer and hidden information

A local log keeps every command in clear. For server-authoritative play, run the same
rules under the network kit's durable authority:

```ts
import { createDurableAuthority } from '@kits/network';
import { turnAuthorityPolicies } from '@kits/turns';
const owner = createDurableAuthority({ schema: rules.id, limits, storage, authorize,
  ...turnAuthorityPolicies(rules, { seed: freshSecretSeedForThisMatch, lineage: matchId }) });
```

The policies carry `lineage` into the authority and mix it into every random stream, so two
matches never share draws even with one seed; still choose a fresh secret seed per match.
Keep the seed on the server, and publish what each player may see through scoped views.

## 5. Test it

Test the rules directly and the log through its statuses: replay determinism (same seed and
commands give the same `stateJson`), preview equals submit, undo/redo, and restore from a
saved snapshot. Name tests after the success criteria they check (`test('S2: ...')`).
