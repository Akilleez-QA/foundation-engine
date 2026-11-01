# Interface control: external dependencies and consumers

Foundation Engine has no runtime interface to another Akilleez-QA repository.
Cstack, POODO, Endoforge and the other Foundations do not import it, and it imports none of them.
This document records the interfaces it does have and where each pin lives.

## Interfaces

| Counterpart | Direction | Interface | Pinned version | Pin source |
|---|---|---|---|---|
| three.js (`three`) | Engine uses | ES module import for rendering | 0.186.1 (range `^0.186.1`) | `package.json`, `package-lock.json` |
| Wasmoon (`wasmoon`) | Engine uses | Lua runtime in WebAssembly | 1.16.0 | `package.json`, `package-lock.json` |
| Node.js | Tooling runs on | `npm` scripts, `node --test`, `tsx` | `>=22.18`, development line 22 | `package.json` `engines`, `.node-version` |
| Games and templates | Consume engine | Author API (`defineGame`, kits) selected by `GAME_DIR` or `--game` | Source checkout at a commit or tag | `git rev-parse HEAD`, release tags |
| Browsers | Run built games | Built output from `vite build` | Evidence per browser run | [Acceptance ledger](../guides/upgrade-acceptance-ledger.md) |

## Change control

A change to any pin above goes through `package-lock.json` and `npm ci`, and is listed in [CHANGELOG.md](../../CHANGELOG.md).
Configuration rules are in [configuration management](../configuration/configuration-management.md).

## Not included

- No interface to Cstack ports or adapters.
- No npm publication; `package.json` sets `private: true`.
