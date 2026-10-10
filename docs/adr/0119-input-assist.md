# ADR 0119: optional aim assist, flick detection and scripted input playback

- **Status:** Proposed
- **Date:** 2026-10-10
- **Area:** Optional kits / Input
- **Tracking:** linked from the pull request

## Context

Creators asked for three input helpers that games keep rebuilding:

- **Aim assist for analog aim.** Choose a target near the reticle, pull the aim toward
  it while the user is aiming, and slow the aim over it. Each effect needs a strength,
  and the result must not depend on frame rate.
- **Flick detection.** Read a quick stick or pointer flick as a directional gesture
  rather than held movement.
- **Scripted input playback.** Drive a scene's systems from an authored or recorded
  timeline, deterministically per tick. Tests and attract mode need it, and an attract
  demo must end when the user touches anything.

The existing seams are the action layer (`ctx.input`: `pressed`, `held`, `axis`,
`pointer`; systems read actions, never devices), the fixed lane and `ctx.time`, and
`testScene({ input })` for caller-owned input sources. The input-history kit records
per-tick action masks, and the replay kit verifies a scene against logged ticks.
Today no owner selects aim targets, recognises flicks or plays authored timelines
into the action layer.

## Decision

1. **A new kit, `@kits/input-assist`.** No dependency, no definitions, no system.
   - `createAimAssist(options).evaluate(frame)` is pure and stateless; the caller
     carries last frame's target. It selects in a cone (priority, then a weighted
     angle/distance score, then id) with optional stickiness, applies friction near
     any candidate in range, and adds magnetism. The pull is limited per second,
     scaled by aim-input activity, and never passes the target. Zero strengths are an
     exact identity.
   - `createFlickDetector(options)` is an O(1) state machine. A flick leaves the
     centre, crosses a threshold within a time limit, and (by default) returns within
     a hold limit. The detector re-arms only after returning inside a smaller radius,
     and keeps a bounded history of recent flicks.
   - Both take time as an input and accept `math: 'deterministic'`.
2. **Scripted playback in `@kits/input-history`, next to the recorder.**
   - `createInputPlayback` compiles a bounded timeline (press, release, tap, axis, at
     ticks or seconds). Each `step(live?)` advances one tick into an `InputSource`.
   - Given the live input, `step` cancels on watched actions or a pointer touch. It can
     loop, and it releases everything when it ends.
   - `over(live)` gives systems a full `InputState`: scripted while playing, live
     afterwards.
   - `timelineFromHistory` converts recorded frames, so a recorded session plays back
     and records again unchanged.

Playback never replaces `ctx.input` in a live visit; a scene opts in by reading
`over(ctx.input)`, and a test passes `playback.source` to `testScene`. The replay
kit's tick tap stays the only owner that substitutes a visit's input, and only in dev
and test builds.

## Alternatives

- **A system that writes the aim.** It would choose the aim's owner (camera, turret,
  character) for the creator. A pure delta composes with each of them.
- **Playback inside the replay kit.** That kit's job is verification, with digests
  and an exact log format. Attract mode and authored timelines need loops,
  cancellation and seconds; they would bend its contract.
- **Playback as a platform input source.** This would require changes in the engine's
  author and platform layers. Neither is needed for tests (`testScene({ input })`) or
  for a scene that reads `over(ctx.input)`.

## Consequences

Creators choose all tuning; the defaults are starting values, not recommendations.
Candidate lists are bounded (at most 256 per evaluation) and must be pre-filtered.
Pull works in yaw/pitch space. The kit has no line-of-sight test, no tracking of
moving targets, and no gating that pulls only toward the aim direction. Engine axis
actions are digital today, so analog magnitude reaches the helpers only through
pointer movement or a creator source.

## Evidence

The evidence is headless only:
- **Aim assist and flicks:** 16 tests, including seeded identity and no-overshoot
  checks, frame-rate independence at 30, 60 and 120 Hz, all 8 flick directions,
  rejection of slow drags and held pushes, and `testScene` consumers.
- **Playback:** 6 tests, including a recorded `testScene` session that plays back
  through `testScene({ input })` to an identical history snapshot, and an attract
  scene ended by a real press.

There is no browser, device or feel acceptance. Independent review and hosted CI are
still required.
