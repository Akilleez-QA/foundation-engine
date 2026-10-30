# Authored documents

Optional headless ownership for creator-defined serialized documents. Import from
`@kits/authoring`; no kit installation, service, scene fields, renderer, event bus or
frame loop is required. A creator may replace or omit this helper.

`createAuthoredDocument({ id, json, limits, validate })` takes a JSON string and a
creator type guard. Only a synchronous literal `true` accepts validation; truthy
objects and promises are rejected. `read()` returns a detached, recursively frozen value, its original
JSON, UTF-8 byte count and edit ticket. `edit(snapshot.ticket, value => nextJson)`
validates a replacement and publishes it together with the next revision. Returning
`null` or rejecting in the validator leaves the current snapshot unchanged.

The exact ticket object represents both the current revision and this owner lifetime.
An older, copied, fabricated or previous-session ticket returns `stale`. Tickets are
not serialized. A reopened owner starts revision zero with a fresh lifetime. Creator
document version fields, migrations and durable revisions remain creator-defined.

`authoredReference(document, id, incarnation)` is an optional immutable reference
convention. **It does not register or allocate identities.** Creators preserve IDs in
their own schema, validate uniqueness, and increment incarnation when reusing an ID
for a different object. Resolution must compare all three fields. Prefab IDs and
world-local entity numbers are separate identities; never persist a runtime entity
number as though it identified an authored instance. No engine schema is imposed.

## Ownership and failure

The caller owns one document owner and disposes it when its editing session ends.
Disposal permanently rejects edits; the last immutable snapshot stays readable.
Nested edits return `busy`. Disposal inside a proposal or validator prevents the
outer publication. Exceptions from JSON parsing, limits or creator code propagate,
leave the committed snapshot unchanged and release the busy guard. Arbitrary external
side effects performed by callbacks are not rolled back. Callbacks should be pure.

Edit results are `accepted` (with snapshot), `rejected`, `stale`, `retired`, `busy`, or
`exhausted` (safe-integer revision limit). Creator validation feedback may be collected
by the creator; this helper does not retain an unbounded diagnostics list.

## Bounds and serialization

Creators explicitly supply positive safe integers `maxBytes`, `maxNodes`, `maxDepth`.
Bytes count the supplied UTF-8 JSON, including whitespace; root depth is zero; every
JSON value counts as one node. Nonfinite numbers, including JSON numeric overflow,
are rejected. Only JSON data is supported: no functions, DOM objects, cyclic data,
typed arrays or arbitrary class instances. JSON parsing has ordinary JSON duplicate
key semantics (last value wins); creators needing duplicate-key rejection should
validate input text before admission.

UTF-16 length is checked before UTF-8 encoding. Byte admission precedes parsing;
node/depth admission follows parsing. These bound retained data and traversal, not
the execution time/memory of arbitrary callbacks, the JavaScript parser, or the
creator's already-allocated input string. During an edit old and candidate data
coexist. Caller-retained snapshots are outside owner retention. No history, timers,
storage or background queues are created.

## Evidence and limits

`document.test.ts` hand-enumerates independent expected placement and dialogue
transitions, identity across a fresh runtime world/reload, stale/reentrant/retired
edits, mutation and callback failures, and byte/structure admission. Both consumers
use the same owner without a common game schema. These are headless contract tests,
not evidence of interactive editor ergonomics or physical-device performance.

History, persistence, picking, previews, world publication and navigation are separate
adapters. Use existing engine persistence/publication owners when those are added;
accepting this document does not publish runtime changes or save it to durable storage.

## Staged documents and optional editing sessions

`prepare(ticket, propose)` performs the same decoding and creator validation as
`edit`, but returns `{status:'prepared',candidate}` without changing the committed
snapshot or revision. `publish(candidate)` accepts only that exact candidate from
this document owner against its still-current ticket. It invokes no creator
callbacks. `discard(candidate)` invalidates a candidate without changing committed
data; repeated discard is harmless. `edit` remains prepare followed by publish.
Candidates are frozen, in-process values; copied, foreign, discarded and superseded
candidates return `stale`. Validation occurs during preparation, so validators should
express document validity rather than time-varying external publication readiness.

The optional `createAuthoringSession(document,{maxEntries,maxHistoryBytes})` borrows
an existing document. It adds one pending draft and a bounded history, with no scene,
DOM, GPU, storage or scheduler dependency. Both limits are positive safe integers.

```ts
const session = createAuthoringSession(document, {
  maxEntries: 16, maxHistoryBytes: 64 * 1024,
});
const result = session.preview(document.read().ticket, value => makeCreatorJson(value));
if (result.status === 'prepared') {
  // Optionally project result.candidate.value into a separate creator-owned preview.
  // A placement consumer could show a ghost; a dialogue consumer could show a card.
}
session.cancel(); // Drop and invalidate the draft; committed data/history stay unchanged.
// Alternatively: session.commit(), then session.undo() or session.redo().
```

`readPreview()` returns the current candidate, or null when absent, stale or disposed.
Preview failure preserves the prior draft. Successful replacement, cancellation,
history reset and disposal invalidate retained draft candidates as well as dropping
the controller's reference. Creator projection resources must be released by their
existing resource owner; these operations do not invoke or roll back external views.

Commit preflights history admission before publishing. History entries retain before
and after JSON strings; their charge is the sum of both UTF-8 lengths, including
repeated endpoints. Undo and redo entries both count. New commits discard redo and
evict oldest entries deterministically to fit both limits. An individual entry that
cannot fit returns `saturated` and preserves document, draft and history. No commit
silently loses its own undo record. Undo/redo revalidate the target JSON and publish
new revisions; a rejected, throwing or stale operation leaves its cursor unchanged.
An unavailable draft/history operation returns `empty`. Even equal JSON commits
advance revision and consume a history entry, matching the underlying document API.

Any direct external document edit makes this session stale. `resetHistory()` explicitly
adopts the current readable document head and clears history/draft. It does not revive
a disposed document. Nested session mutations return `busy`; disposing the session
inside a proposal or validator prevents outer publication. Session disposal is
idempotent and clears its draft/history; it does not dispose the borrowed document.
The exact document owner is the authority: direct calls may deliberately supersede
session state, and session conflict checks prevent subsequent overwrites.

`stats()` reports entry count, cursor, serialized history bytes, pending draft,
retirement and stale-head state. History limits do not bound caller-retained
snapshots, candidates, projection resources or JavaScript heap overhead. Candidate
branding uses weak membership, so the document owner does not permanently retain
prepared candidates. Old committed data, a candidate and planned history may coexist
during an operation; callback execution and parser allocations are not CPU/heap
sandboxed. Runtime projection and saving remain separate: an accepted commit means
in-memory document publication, never renderer synchronization or durable storage.

`session.test.ts` exercises placement and dialogue projections using the same
controller, cancellation, history branching and independent limits, failed undo,
external conflicts, lifetime/reentrancy, candidate invalidation and monotonic
revisions. These headless checks establish no graphical interaction, durable reload,
or physical-device performance claim.
