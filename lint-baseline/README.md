# Lint ratchet baselines

These are the known counts that the ratchet lints allow. A count may fall but never rise (STANDARD chapter 3, STD-LAY-9, STD-CNF-7).

| Lint | Shards | Lower after a fix | First shards of a new rule |
|---|---|---|---|
| `scripts/lint/architecture.mjs` (owned-global patterns and layer violations, per top folder of `src/`) | `<rule>/<folder>.json` | `node scripts/lint/architecture.mjs --lower` | `--init-rule=<name>` |
| `scripts/lint/css.mjs` (unlayered CSS, unscoped feature selectors, hex colours, `!important`) | `css/<rule>.json` | `node scripts/lint/css.mjs --lower` | (none) |

The engine starts with no shards, so every baseline is zero. Any match of a strict rule outside its owning folder fails, and so does any new match of a ratchet rule. A game that adopts the engine over existing code may commit shards for its known debt. After that, the shards only shrink: `--lower` rewrites a shard whose count fell and never raises one.

Performance budgets follow the same rule in `game/budgets.json`, enforced by `scripts/perf/budget-ratchet.mjs`. There, a raise needs a `Perf-Budget:` commit trailer.
