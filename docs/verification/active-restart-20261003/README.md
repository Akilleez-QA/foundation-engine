# Active-window lifecycle correction — 2026-10-03

The public-main bench reused an already-running first scene for startup, settling,
an idle sample and an active sample. A terminal gameplay state can occur during
those earlier stages. Repeating held movement input on the same ended visit cannot
restore a playable workload; the existing no-frame refusal correctly blocks it.

## Observed failure

[Hosted run 37141691681](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37141691681)
reported zero rendered frames in the active window on all four attempts, then again
on the confirming bench. Its earlier smoke run was playing at simulation time 2.4s.
The benchmark did not record the game phase, so the log alone did not prove why it
stopped drawing.

A separate bounded diagnostic on public-main engine code recorded the actual
lifecycle in [lifecycle.json](lifecycle.json): the stock template, seed 1, reached
its terminal state at 5.7167 simulated seconds. The bench's old movement sequence
produced zero additional renders. A native Space press entered a new scene epoch
at time zero; native left/right input then produced 206 renders and remained in
play. This used the dev API only to observe state; it did not mutate game state or
force drawing. It is not itself the production benchmark.

## Change and production evidence

An optional author-declared `activeRestart` waits for a visible terminal marker,
presses the existing restart key, requires the old marker to detach, and waits for
the same scene to become active. All waits and the input action share a remaining
deadline. Setup precedes every active attempt and its bounded re-samples; it never
runs inside the measured window. The template declares left/right steering keys.
No gameplay systems, budget values, classifier rules or tolerances changed.

The setup limit is 30 seconds per attempt. Missing setup fails immediately after
that deadline rather than retrying an unprepared sample. Four non-comparable
measured attempts can add up to 120 seconds of preparation. No CI timeout changed.
The observed production setup took 140ms.

At clean source commit `636e308e87c288a7781edacccd0ce1a0ed0bebc6`, under Linux,
Node 22.23.3 and Chromium 152.0.7977.82, the real production build was tested with:

```sh
GAME_DIR=templates/arcade/game npm run bench -- --only play --json /tmp/active-restart.json
```

[production.json](production.json) retains the exact run, build digest, environment,
helper hashes, setup declaration and active-key plan. Both windows were steady;
there were zero rejected or inconclusive samples and zero over-budget verdicts.
The active window rendered 206 frames in 4005ms, averaging four draws with a maximum
of six. Its existing heap rule reported a warning: 5.4 MiB versus 5 MiB (+8%). This
warning is retained; no threshold was raised. Software-GL timings are advisory,
not physical-device certification. Browser and server closed normally.

Ten focused restart/input-classification tests, typecheck and all lints passed
under Node 22.23.3. Tests cover missing terminal state, failed visit retirement,
shared deadline options, restart-before-each-retry, preserving measured counts,
and continued refusal of an unprepared/dead workload. The budget ratchet reports
zero increases. The subsequent edit only clarifies comments and records evidence;
this is not a claim that full integration gates ran on the receipt commit.

Hosted CI remains the integration requirement. No full local template gate was
run, and the diagnostic does not establish arbitrary-game setup suitability.
