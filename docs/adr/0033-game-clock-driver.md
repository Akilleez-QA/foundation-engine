# ADR 0033: One game clock, driven only by the loop

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Time

## Context

Wall-clock reads scattered through gameplay make time untestable and let paused or covered screens advance.

## Decision

- Game time is float64 seconds on a Unix-seconds timeline (`gameSeconds(unixMs)`), per player, and starts at the real date for a new player. It advances only while playing and only through the loop.
- `createClock()` returns two capabilities:
  - `GameClock`, for every module: `ut`, `warp`, `realNow`, `schedule`, `pause/resume(owner)`, `requestWarp/releaseWarp`, `onCatchUp`, `calendar()`.
  - `ClockDriver` (`advance`, `resumeFromAway`, `snapshot`, `restore`), held only by the frame loop and the save store.
- `core/rng.ts` gives seeded streams by name.
- Lint bans `Math.random`, `Date.now` and `performance.now` outside the kernel.

## Consequences

- Tests set the date and freeze time.
- Time away is capped and delivered only to systems that opt in.

### Timeline replacement during an advance

A scheduled callback can change players through the save service, which restores
the new player's timeline synchronously. The old advance must not overwrite that
restored UT or wall-time checkpoint, apply its old warp calculation, or consume the
new timeline's events. A timeline identity check after event and policy callbacks
ends that advance with `from === to === restored UT`, `realDt: 0`, and the restored
clock's current warp. The following advance resumes normally. This zero-duration
result also prevents the player-clock recorder from charging old-player elapsed
time to the newly selected player. No additional clock or scheduler is introduced.
