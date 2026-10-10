# Sequences: scripted cue tracks with barriers, skip and saves

The optional `sequence` kit runs creator-authored multi-track cue lists one fixed
step at a time. Use it for a staged scene, a guided moment, a door that opens after
a camera move and a line of dialogue, or any set piece that must survive a save and
a skip without granting a consequence twice.

## Shape

A definition has tracks; each track plays its cues in order. A cue lasts `ticks`
fixed steps once started. `after` makes it wait for cues on other tracks (a
barrier); `hold` makes it wait, once its time is up, for `release(cue)` (for
example when a dialogue closes or the player acts). A cue with an `effect` returns
that identity once, when it completes.

## Driving it

Advance from a fixed-step system you own (`run.advance(1)` per step). Treat
`start`/`end` events and `active(track).alpha` as presentation: request audio cues,
set animation clips, feed a camera kit `options` callback. Treat `effect` events as
gameplay intents and apply them in the same step. The kit never calls your code.

## Skip, cancel and saves

`skip()` completes everything at once and returns only the effects marked `land`
(the default); presentation effects marked `onSkip: 'drop'` are dropped, and no
presentation events are produced, so the camera and audio simply settle on their
final state. Skip happens at the current tick; ticks still owed by a budget-stopped
call are discarded. `cancel()` stops without landing anything further. With a small
transition budget, call `advance(0)` until `run.settled` before acting on what it shows.

Give each run a session that is unique for that definition and keep it across reloads
(`createSequence(def, saved.run?.session ?? newRunId(), saved.run)`). Store `run.snapshot()` in a `defineSequenceSection` record in the same save as the
consequences of the effects you applied. A restored run continues with the same
future events. Editing a definition changes its fingerprint, so old snapshots are
refused rather than reinterpreted; give the edited sequence a new section or migrate.

## Bounds

See the [kit README](../../src/kits/sequence/README.md) for the full contract:
definition limits, the per-call transition budget with `owed` ticks, canonical
event order, validation and limits.

## Cast, branches and one event at a time

Bind the entities a sequence moves with a cast. Your systems ask `cast.drives(e,
'position')` before writing a channel and `cast.gate(e)` before updating anyone, so
the rest of the world holds still. Entities that were mid-action finish first, and
`cast.ready()` tells you when the stage is quiet. Join sequences at held cues to
branch on a player's choice; `choose` abandons the rest of the current scene, and
`skip` follows each branch's default. Use the event arbiter to let only one trigger,
conversation or scene claim the stage at a time, by priority, with cooldowns so a
trigger the player is standing in does not refire.
