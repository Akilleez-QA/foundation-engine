# ADR 0124: slot, stack and key-item rules over the inventory ledger

- **Status:** Proposed (candidate implementation)
- **Date:** 2026-10-09
- **Area:** Optional kits / Inventory

## Context

The inventory ledger owns quantities per container and batch, atomic exchanges, reservations and replayable
history, with one quantity capacity per container. Many games limit inventories differently: a number of slots,
a stack size per material with overflow into new slots, items that cannot be thrown away, unique items and items
restricted to certain containers. Re-implementing those limits beside the ledger risks a second owner of the same
stock. The creator asked for inventory rule presets on the inventory kit, including faithful presets of published
games' rules.

## Decision

Add `defineInventoryRules` and `createRuledInventory` to the inventory kit as an additive facade over the existing
ledger, plus a read-only `contents(container)` on the ledger. Rules check every operation on the projected contents
before the ledger applies it; refusals are explicit and leave no receipt. Ledger capacities are derived from the
rules so the ledger is never stricter. Snapshots stay the ledger's and restore replays history through the rules.
Presets include a named reproduction of a 1996 handheld RPG's bag as documented by a cited community
reconstruction, and generic archetypes.

## Consequences and evidence

Games keep one stock owner and gain declarative limits. Rule changes require a save migration, as capacity
changes already do. Checks scan the touched containers' contents (and all containers for ownership caps), so they
are per-action costs. Focused headless tests cover spill and slot limits, key-item discard/use/move, unique
ownership, single-slot stacks, unstackable materials and placement, and snapshot replay including refusal of a
history that breaks tighter rules. No UI, game integration or device acceptance is claimed.
