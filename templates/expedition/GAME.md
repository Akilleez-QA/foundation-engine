# Field expedition

## Brief

Goal: Complete a guided field survey with reliable cancellation, dialogue and persistent rewards.

Pitch: Visit three stations on a small terrain; each arrival advances the survey exactly once.

Genre: expedition. Neutral audience. Devices: desktop, laptop, tablet, phone; minimum phone. Inputs: keyboard, pointer, touch, gamepad. Core loop: read the briefing → choose the next station → follow the route → collect the survey badge.

## Success criteria

| Id | Check | How |
|---|---|---|
| S1 | route planning never counts as physical arrival | test: `game/field.test.ts` |
| S2 | stopping cancels movement and permits a fresh route without losing collected stations | test: `game/field.test.ts` |
| S3 | three arrivals award one badge and replay or reload cannot duplicate it | test: `game/field.test.ts` |
| S4 | dialogue accepts only the current session revision and saved state restores | test: `game/field.test.ts` |
| S6 | optional assistance and functional gear change pace without cosmetic mastery grants | test: `game/field.test.ts` |
| S7 | survey, finite collection and crafting resume after exit without duplicate materials | test: `game/resources-station.test.ts` |
| S5 | the field stays within measured per-scene budgets | gate |

## Milestones

1. A compact playable consumer of navigation, objectives, dialogue, inventory, terrain and owned audio.
2. Measured desktop/phone verification and full integration gate.
3. Bound overlapping outgoing and incoming dependency owners with one shared allowance; verify denial before acquisition and capacity recovery after cleanup.

Controls: touch/click the bottom action button, Enter/Space or gamepad A to continue; Stop, Escape or gamepad B to cancel movement. Choose Guided pace in the briefing for optional slower movement, recorded as a tutorial assistance grant rather than practice mastery. Equipped trail boots supply a source-owned pace modifier; the cosmetic cap supplies no functional effect. Decorative stars and independent lighting use the space/environment API, without claiming a scientific star catalog. A single compact in-scene panel owns the briefing and current action. The open field has authored safe waypoints; this does not demonstrate a general collision-aware navigation mesh. Route computation and physical movement are separate. After the badge, the same primary action surveys a finite deposit, collects four ore units and makes one plate. The small field is procedural abundance, not validated resource geology; no combat or multiplayer is implied.

One `expedition.session` save envelope holds the briefing, objective and reward ledger. Departure cancels route/audio but keeps collected evidence. A separate `expedition.resources` envelope holds all material stock, reserves, machine progress and resource-stage acknowledgement together. Mid-collection exit resumes from its saved cursor; it never replays already consumed reserves. Surveying is capped at four points per frame; production at two ticks and one cycle. Returning restores the last collected station, and completed expeditions do not mint another badge. The UI says earned, not durably saved; storage failures remain the engine save service's responsibility. This example teaches engine integration, not an assessed science curriculum.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-09-30 | Shared 416-byte preparation allowance across retained and incoming closures; denial, late cleanup and retry regression coverage | Existing render and scene caps unchanged |
| 2026-09-30 | Guided expedition integration with cancellation and single-envelope progress/reward | 6 draws / 1,248 triangles observed while walking; derived caps in game/budgets.json |

| 2026-09-30 | Optional post-survey resource station: cancellable scan, finite extraction, exact-batch weighted recipe, resumable single-envelope production | No new meshes; check, touch/reload and production bench pass; existing caps unchanged |

The first route now passes through a visible two-post doorway. Its frame/contact
closure must be ready before crossing, and authored body clearance is checked at
the crossing. Navigation requests share a prepared graph through a bounded fair
queue. A follower observes resolved movement and stops rather than awarding an
arrival if the doorway remains blocked. Stop/continue starts a fresh user request.
The closure uses the existing frame loop and an injected lease seam; no additional
worker pool or asset cache is created. This finite doorway is not a streamed
building or a general collision mesh demonstration.

The routed shelter is a readiness fixture, not an expansion of the game. Its
restricted preparation callback waits for contact/frame dependencies while the
previous scene remains usable. The router releases the previous renderer before
creating the destination. Failure/cancellation paths are exercised independently
with the real handover and dependency owners.

The outgoing doorway and incoming shelter preparation share a conservative 416-byte
allowance. Each closure declares 208 bytes; a third concurrent closure is rejected
before acquisition. The diagnostic records shared bytes and owner count in typed
state, without adding interface controls or rendering. Cancellation retains its
charge until outstanding acquisition results have been released.
