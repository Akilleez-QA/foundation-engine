# Mechanics lab

## Brief

Goal: Exercise local engine ownership through a guided ride, delivery and nonviolent probe experiment.

Pitch: One compact lab makes frame, seat, equipment and event contracts visible.

Genre: mechanics. Neutral audience. Devices: desktop, laptop, tablet, phone; minimum phone. Inputs: keyboard, pointer, touch, gamepad. Core loop: ride the platform → collect and equip a probe → tag the moving target.

## Success criteria

| Id | Check | How |
|---|---|---|
| S1 | rider pose follows the vehicle with independent movement disabled until validated exit | test: `game/lab.test.ts` |
| S2 | repeated collection does not duplicate inventory or debit and equipment gates probe use | test: `game/lab.test.ts` |
| S3 | one probe action emits one marker and commits one moving-target tag | test: `game/lab.test.ts` |
| S4 | desktop and phone lab stay within measured scene budgets | gate |

## Milestones

1. One local lab consumes frames/vehicles, animation sockets/markers, capability/equipment, market/inventory and swept collision kits.
2. Desktop/phone walkthrough and restart verified in isolated muted Chromium; screenshots reviewed; scene tests pass and measured budgets derived.

Controls: Tap the single contextual action button, E, or gamepad A. The introductory ride is guided. Walking after dismount uses arrows/WASD/left stick. The touch happy path needs only the button; joystick locomotion is outside this lab. A second attempt restarts the visit.

This demonstration is local. Delivery stock and debit persist in one versioned save section; visit state resets on restart. It does not claim server commerce, full skeletal animation, physical flight or scientific sensor accuracy. Probe sweeping is a nonviolent moving-target geometry experiment. Market/inventory handoff stages both local snapshots before publication; both snapshots publish together through the existing save section, then the inventory epoch rejects pre-checkpoint retries. This uses the engine save service, not a server transaction.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-09-30 | Guided ownership and mechanics integration lab | Measured 5 baseline / 7 peak action draws, 1,172 / 1,196 triangles; derived caps in game/budgets.json |
| 2026-10-02 | Probe hit cue: `maxDistance: 60` replaced by `cutoffDistance: 60`. With the inverse model `maxDistance` was ignored (Web Audio spec) and the cue still played at ~12.5% gain at 60 m; it is now silent beyond 60 m. Gain within 60 m is unchanged | Unchanged (audio only; no draw or triangle change) |

Actor ownership uses the optional control kit: validated ride/exit publishes a
single controller/frame snapshot, cancels the existing input epoch, and clears
character motion and camera history. Movement after leaving a seat requires a
fresh input gesture. Rejected exits retain the seat and controller.

After tagging, place the existing station, leave it, and pack its recoverable manifest. Occupied or unauthorized packing refuses without mutation. The probe pulse samples a local pose clip without moving the authoritative actor or adding draws.

The original CC0 beacon fixture consumes the actual leased GLB model path. Its
two-link skeleton runs a `pulse` clip; the lab samples that socket
through the author API. Model parsing, skeletal instances and playback remain
owned by the scene visit. The fixture adds one small draw within the existing cap.

The same diagnostic model consumes explicit authored root motion through the existing character collision resolver and control owner. A masked rotation layer applies two-link IK after native clip translation; its motion stops at an invisible test blocker. This is engine contract evidence, not a gameplay expansion or automatic glTF root-motion extraction.
