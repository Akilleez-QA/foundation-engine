# Condition projection composition lab

This unexported headless experiment composes existing equipment, capability
modifiers and SaveStore. It tests creator-owned item condition independently from
the equipment kit's functional/cosmetic intent. No public kit, equipment mutation
API, durability rule, scheduler or ADR is introduced.

Two small consumers choose different meanings for the same bounded numeric data:
an equipped coat contributes guard while its authored wear value exceeds zero; a
lamp contributes light while its charge count exceeds zero. Repair/recharge are
ordinary accepted condition changes. These are example rules, not engine policy.
Neither fixture drives an actual combat system, lamp renderer, inventory UI or
charging station.

## Existing seam and actual gap

Equipment already owns unique custody, multi-slot displacement, bag capacity and
revisioned arrangements. Its `functional` flag separates functional from cosmetic
intent. Condition must not overwrite that meaning. Capability modifiers already
validate finite arithmetic and rebuild from source contributions. SaveStore already
owns versioned envelopes, write status and quarantine.

The experiment supplies the missing creator composition: a condition table keyed
by fixed owned instance IDs and one revision covering condition plus arrangement.
It projects the intersection of equipped functional-intent IDs and condition
eligibility into the existing modifier reducer. Modifiers are derived on restore;
there is no independently saved modifier cache to become stale.

`conditionFixture` captures a creator definition. Numeric condition units, maximum,
eligibility threshold, contribution rows, equipment slots and base values belong
to that definition. Definition identity must change when those rules change, or the
creator must migrate the envelope explicitly; this lab implements no migrations.
The fixture keeps a fixed item set. Acquisition, release, instance-ID recycling,
inventory transfer and a condition history ledger are outside its scope.

## State publication and ownership

The application supplies its existing SaveStore and creates one owner for the
active player and AbortSignal. Retire it before replacing the owner or disposing
the store. Abort/dispose removes subscriptions and callback authority; a player
switch retires the owner permanently, including when switching back. An external
save replacement/import/reset also retires the owner on its next operation by
checking immutable SaveStore value identity.

`prepare(id)` retains at most one exact-object ticket at the current revision.
`update(ticket,value)` validates the creator domain, increments a detached
candidate's revision and computes its complete modifier projection before any
publication. `equip(id,expectedRevision,wear?)` uses the actual equipment owner's
commit on a candidate, then validates the same combined projection. Successful
condition or arrangement changes retire pending authority. Copied/foreign/stale
tickets and old arrangement revisions cannot publish. `cancel` retires only the
ticket. An unchanged update consumes its ticket without increasing revision.

Projection uses a single source-owned modifier transaction containing all selected
rows in stable item-ID order. This prevents false intermediate overflow during
partial installation and catches actual overflow when a cancelling contribution
is removed. A failed projection or exhausted revision leaves state and ticket
unchanged. Domain refusal and equipment capacity refusal likewise retain work for
retry. This is a synchronous count-bounded operation, not a frame-loop subsystem.

## Persistence and bounds

One physical section holds schema, definition identity, outer revision, equipment
snapshot and condition values. The parser requires both sides, validates fixed
custody facts and bounded conditions, reconstructs through the existing equipment
API and checks the derived projection before acceptance. It rejects mismatched
definitions, duplicate/missing condition rows, excessive lists, malformed values,
equipment revision newer than the enclosing revision and overflowing projections.

Successful writes return `saved`. A failed write returns `save-failed`: the coherent
new candidate remains session-only, not rolled back or durable. Further commands
are blocked until `checkpoint` retries through SaveStore. A crash/reload sees the
old coherent envelope. `view().status` exposes this distinction; callers must not
announce session-only changes as saved. Quarantined, unavailable or newer-version
sections refuse work rather than overwriting fallback state.

Maximum retained definition/state: 8 item instances, 8 slots, 8 base stats, 8 rows
per item and 64 contribution rows total; bag capacity 0–8; identifiers admitted by
this definition are at most 64 UTF-16 units. Conditions are nonnegative safe integers
within creator maxima. One pending ticket is retained. These small lab bounds are
not changes to public kit capacities. Projection and validation scan the configured
tables, allocate candidate copies and do no idle work. They are not exact heap/CPU
budgets or an arbitrary JavaScript/proxy sandbox. Serialized byte-size admission
and hostile-object isolation are not supplied here.

The coherent envelope does not make external inventory, damage, visual effects,
network services or several SaveStore sections atomic. This lab has no durable
command receipt for an external decrement request: after an ambiguous response,
re-read saved condition and revision before constructing a new command. Do not
retry a decrement blindly or claim external exactly-once behavior.

## Evidence

```sh
node --import tsx --test tools/condition-projection-lab/condition.test.ts
npx tsc --noEmit -p tools/condition-projection-lab/tsconfig.json
```

Twelve focused tests cover both consumers, real fresh-store reload continuation,
write failures, derived overflow, capacity/domain refusal, cosmetic separation,
stale/copied/foreign tickets, arrangement invalidation, external rewind, player
replacement, abort, immutable definitions, counter exhaustion and actual SaveStore
quarantine. Crash cuts copy only committed MemoryBackend bytes before disposal
could flush. Tests use real equipment/modifier/save implementations; the condition
table and threshold policies are explicitly fixture-owned.

The repository's newer `tools/**/*.test.ts` discovery pattern includes this file.
The branch baseline's older test command does not; until that discovery change is
integrated, use the explicit command above. There is no wrapper that would cause
duplicate execution once the broader pattern is present.

No full CI, browser, visual, physical-device, performance or runtime playability
acceptance is claimed. Public API graduation is deferred: this experiment does not
justify a general condition framework or changing equipment semantics. A broader
consumer may need different scalar types, multiple conditions, instance retirement,
atomic resource consumption and migrations; define those contracts explicitly.
