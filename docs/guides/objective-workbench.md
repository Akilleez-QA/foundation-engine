# Optional objective workbench

This desktop keyboard/pointer diagnostic composes existing staged objectives,
authored documents, bounded edit history and save sections. Its graph and outcome
vocabulary are example choices. It does not install an engine editor, scheduler,
quest design, reward policy or global shared-work manager.

## Authored graph and isolated preview (A)

`tools/objective-workbench/graph.mjs` exports `initialGraph`, `captureGraph` and
`outcomeFor`. A graph contains `version: 1`, an existing `StagedDefinition`, and an
`outcomes` array. Each terminal edge has exactly one
`{stage, choice, units, capability}` outcome; nonterminal edges have none. The
sample permits integer units from zero through eight and a nonempty capability
label up to 64 characters. These are creator schema choices, not kit restrictions.
The definition is validated by the actual `createStagedObjectives` owner, including
acyclic edges, destinations, requirement targets and unique identities. Whole
imports, headless edits and restored saves use the same capture path. Unknown
fields, missing outcomes and malformed references reject with field-oriented
messages. Captured graphs are detached and deeply frozen.

`createEditorController({saveHandle, readPersisted})` owns one authored document,
one authoring session and at most one isolated runtime preview. The methods used
by the native UI and headless callers are identical:

- `preview(graphOrJson)` validates a complete candidate and starts its provisional
  objective run. The accepted graph remains unchanged. An invalid replacement
  clears the previous candidate and preview before reporting rejection.
- `commit`, `cancel`, `undo` and `redo` retire preview authority. Commit changes the
  authored graph only. Undo/redo changes document history, not an adopted run.
- `startPreview` restarts from the candidate or committed graph. `captureEvent(id,
  event, amount)` returns a delayed delivery callback holding both exact preview
  owner identity and the stage ticket captured at admission. `choose(choice,id)`
  invokes the actual staged transition. Replacing/closing a preview, committing,
  undoing or disposing cannot make a retained callback authoritative again, even
  when the graph JSON and textual run IDs become identical. Earlier-stage results
  also fail the staged owner's incarnation check.
- `save` writes the accepted graph through the supplied SaveStore section; it never
  stores provisional progress. `read` reports graph, candidate, document revision,
  provisional runtime view, history, recovery and persistence. `dispose` retires
  the document/session and preview; retained operations refuse.

The graph keeps the staged kit's ceilings of 64 stages, 64 requirements per stage
and 16 choices per stage. Preview has 64 events per stage. The authoring document
is bounded to 128 KiB UTF-8, 16,384 values and depth 24; history retains at most
16 entries and 512 KiB across serialized before/after endpoints. History is local
to one visit. Reload starts fresh history and no preview. Outcome entries are
bounded to 1,024 and correspond exactly to terminal edges. Limits bound retained
input/state; arbitrary creator callbacks are not CPU-sandboxed.

## Graph persistence and adoption boundary

Section A is `objectives.graph`, with physical key
`objective-workbench|device|objectives.graph`. Accepted edits live in memory until
saved; failed storage does not undo their history. “Saved” requires SaveStore's
saved status, an existing version-1 physical envelope, and equality with the
accepted graph. Default absence is unsaved. Initial physical data must match the
captured handle. Newer, quarantined, unreadable or incoherent graph data blocks
editing and save rather than granting fallback defaults authority. Recovery means
restoring readable valid data and loading a fresh controller. The section is local
single-writer storage. Compose `createGraphStoragePort` with the runtime section
guard before constructing SaveStore. The graph guard refuses externally changed
or deleted bytes on both reads and writes, including autonomous retry and final
dispose flushes; observing a conflict in a UI controller alone cannot stop those
writes. This synchronous guard supplies no distributed compare-and-swap.

Section B owns its adopted graph and consequences independently. Adopting a
committed A graph is an explicit B operation; A editing, preview, undo, save or
reload never mutates B. The two sections are not one atomic transaction. An older
adopted B definition remains meaningful after A is edited, and B can continue
independently when A requires recovery. No automatic migration of progress is
implied. The B controller documents its separate acknowledgement protocol.

## Adopted runs, related work and consequences (B)

`createRuntimeController({saveHandle, readPersisted, saveBuild})` owns one accepted
runtime document and at most one attempted pending publication. Pass the same
primitive `saveBuild` string (1–256 characters) as the configured SaveStore build.
This sample has no legacy metadata. Before admitting a pending write, it checks
the complete `{v, by, data}` envelope against the section's 131,072-character limit,
as well as the document's UTF-8, node and depth limits. Oversized candidates refuse
without locking subsequent operations. Supplying mismatched metadata violates the
adapter contract; the author handle does not expose or attest the store's build.

`preview` prepares explicit adopt, choose, cancel-run or capacity-release commands;
`commit` attempts the candidate, and `retry` writes that same snapshot. Once a write
has been attempted, competing commands and cancellation refuse. `acknowledge`
requires matching physical version/data and SaveStore's saved status before
publishing accepted progress or consequences. A background or teardown write may
make the candidate durable before acknowledgement; reload restores those coherent
bytes, but a retired controller cannot publish them into the old visible scene.

The runtime retains up to 16 adoptions including the initial one, 64 lifetime
command receipts, and 64 events per stage. Every adoption captures its complete
graph and terminal outcome definitions. Retained run facts and consequence
provenance are replay-validated against their own adoption, never a later edited
graph. Overflow refuses before publication; receipts are not pruned to permit
identity reuse. A new adoption restarts progress and may intentionally earn again.
Retrying an old command returns its prior identity without earning twice. The
sample inventory has eight units of capacity, and capability labels are authored
data. Neither is an engine-wide gameplay rule.

`acquireWork`, `releaseWork`, `emitWork`, `reconcileWork` and `resetWork` compose a
finite source with two exact recipient leases and one shared subscription. Releasing
one recipient preserves its sibling; final release removes the listener. Completed
facts survive a recipient's temporary refusal and reconcile explicitly after the
pending write is acknowledged. Source generations retain recipient stage tickets:
a later stage requires all leases released and an explicit reset, while adoption
resets the source automatically. Already-completed facts can serve their original
stage without creating a listener. Nested emission during input capture refuses.
Opaque subscription, consumer and adoption lifetimes reject callbacks retained
across release or replacement. Cancellation revokes local publication authority;
it does not promise reversal of external work or already accepted consequences.
Cleanup exceptions are recorded separately rather than presented as rollback of
an accepted adoption.

Compose both section-specific storage guards before constructing SaveStore. B's
strict restore, pending retry and physical readback are independent of A's graph
editor. These synchronous local guards preserve observed external replacements;
they do not provide cross-process transactions or exactly-once remote effects.

## Evidence scope

Focused A checks:

```sh
node --import tsx --test tools/objective-workbench/graph.test.mjs tools/objective-workbench/editor-controller.test.mjs
```

These exercise invalid import/edge/node/cycle/outcome rejection, detached capture,
real provisional progress, duplicate and late events, undo/redo, identical-graph
replacement, bounded history, quota failure/retry/reload, corrupt/newer recovery,
startup physical mismatch and disposal during input capture. They are not native
browser, phone/tablet, accessibility, physical-device or performance certification.
Native UI, combined A/B acceptance and revision-specific browser/gate evidence are
recorded separately after execution.
