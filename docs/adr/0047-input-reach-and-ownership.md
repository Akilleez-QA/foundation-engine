# ADR 0047: Reachability is a path; an input press has one owner

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Input
- **Related:** [0044 One action map: keys, pad and pointer resolve to registered actions](0044-one-action-map.md)

## Context

A press delivered to two consumers, or a held key leaking into the next scene, feels broken and can trigger actions the player never chose.

## Decision

- A press is dispatched once, to one owner, with an owner epoch. An action addressed to an old epoch is discarded.
- Route changes, player changes, pause, overlays, blur, disconnects and remaps cancel queued and held input. A neutral input is required before input rearms.
- Reachability accepts a direct binding or a verified focus path per device. No chord or timed hold is the sole route.

## Consequences

- `platform/input/actions.ts` (`cancel`, epochs), `held.ts`.
