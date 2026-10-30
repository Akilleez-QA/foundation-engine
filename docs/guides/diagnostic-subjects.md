# Optional diagnostic subject associations

Creator requirement (P-D1 / AC-D): identify the authored subject, accepted revision
and source behind a diagnostic without changing gameplay or diagnostic producers.
The existing seam is the script-owned evidence report. The optional
`scripts/play/diagnostic-subjects.mjs` helper validates a capture-time sidecar;
it has no production imports, registry, cache, listeners, history or callbacks.
No existing diagnostic script is wired to it yet. The browser consumer belongs to
the integrating task. This scoped implementation changes no build brief or budget.

## Ownership and use

The creator adapter owns subject semantics, source locators and revision policy.
The calling diagnostic script owns capture lifetime, raw evidence and storage.
Scene, terrain and asset owners retain their existing resources. Import
`captureDiagnosticSubjects(input, limits?)` from the script helper. It synchronously
returns `{ok: true, sidecar}` or `{ok: false, error: {code, path}}`. A failure emits
no partial sidecar. Discard failed captures and explicitly capture again after fixing
the cause; there are no retries or background work. Cancellation before invocation
is the caller's responsibility; there is nothing to cancel or release afterward.

Supply plain data, with exactly these fields (all are required; `source` can be null):

```js
const result = captureDiagnosticSubjects({
  captureId: 'run-17',
  before: {available: true, token: 'visit-4/document-8'},
  after: {available: true, token: 'visit-4/document-8'},
  digests: {
    build: {provenance: 'unavailable', value: null},
    configuration: {provenance: 'unavailable', value: null},
  },
  records: [{
    target: {ownerId: 'scene-visit', epoch: '4', kind: 'entity', id: '12'},
    provenance: 'observed',
    artifact: 'entities.json#12',
    completeness: {
      status: 'partial',
      counters: [{name: 'omittedComponents', value: 2}],
    },
  }],
  associations: [{
    subject: {namespace: 'assembly', subjectId: 'hinge', revision: 'drawing-8'},
    source: {
      path: 'creator/hinge.json', selector: '/parts',
      digest: {provenance: 'unavailable', value: null},
    },
    relationship: 'represents', provenance: 'declared',
    targets: [{ownerId: 'scene-visit', epoch: '4', kind: 'entity', id: '12'}],
  }],
});
```

Success contains `schema: 'diagnostic-subjects/1'`, `captureId`, the accepted
`token`, `digests`, `records` and `associations`. Every accepted field is explicitly
validated and copied into detached JSON data. Output is mutable, independently of
input and other outputs. There is no arbitrary payload field or generic clone.
Unknown object fields, accessors, malformed Unicode and sparse arrays are rejected.
Array elements are copied by index; non-index array properties are not evidence.

The complete target key is `(captureId, ownerId, epoch, kind, id)`. All parts are
nonempty strings; adapters must explicitly encode numeric runtime IDs. `kind` is
creator/producer-defined. For a timing row, encode ordinal **and** sequence in `id`;
use the timing capture identity in `ownerId`. Display labels are not identities.
Terrain generation epochs and scene epochs belong to different owners even when
their numeric values match. Every association reference must resolve within this
sidecar. Repeated records or repeated targets within one association are rejected;
many subjects may reference the same record. Multiple relationships for the same
subject are allowed. Consumers joining sidecars must retain `captureId`.

Read `before` from the live accepted state, collect records and associations, then
read `after`. The adapter must include every relevant owner lifetime and accepted
subject revision in its token, using a bounded monotonic version or a digest of a
canonical version vector. Owner loss sets `available: false`; changed tokens yield
`stale`. Do not recycle tokens across replacement or a change-and-revert (ABA).
The helper only compares supplied stamps; it cannot observe live owners, detect
lying/stale adapters or establish atomicity across asynchronously captured pages.
Include state changes relevant to the intended snapshot in the token, or preserve
producer partial/non-atomic evidence explicitly. Pending terrain replacement keeps
the current accepted subject revision until publication. Playback restart counters
and world mutation counters are not authored revisions. Historical sidecars keep
their captured revisions.

## Provenance and completeness

Record and relationship provenance accepts `declared`, `observed`, `estimated`,
`derived`, `consumer-reported` and `unavailable`, without promotion or inference.
An observed record does not make its authored subject link observed. Raw artifacts
remain responsible for actual measurements, units, methods and detailed evidence.
In particular, a shared system invocation remains one record: this helper never
copies, apportions or fabricates per-subject durations.

Producer completeness is retained as `status` (`complete`, `partial`, `unavailable`)
and named nonnegative safe-integer counters, including original omission/loss
counts. Counter names must be unique within a record. These are producer assertions,
not a computed whole-report completeness certificate. Supply one record per relevant
producer scope/page when their completeness differs. Successful validation means
all supplied associations were admitted, not that every possible subject was captured.

A digest is `{provenance, value}`: provenance is `declared`, `observed` or
`unavailable`. Unavailable requires `value: null`; the other two require a nonempty
bounded string (prefer an algorithm-prefixed digest). Missing fields are invalid;
missing evidence must be explicitly unavailable. The helper does not hash bytes or
verify caller claims. Use observed only when the caller actually hashed the relevant
bytes. A Git HEAD is not an executable/build digest. A null source means no source
locator is available; it is never reconstructed from a label or runtime ID.

Selected asset variants can be scoped diagnostic records referenced through a
`uses asset` relationship. Put content digests and their provenance in the raw asset
artifact; a manifest association cannot observe a stock model's adopted lease.
Repeatable evidence additionally needs pinned source/build/assets, harness/config,
route/parameters/seed, actions and readiness, viewport/DPR/view/quality, browser and
backend assumptions. Store these in raw evidence artifacts. Source, asset or config
changes must change their fingerprints even at the same Git HEAD. This sidecar is
traceability, not a universal experiment schema or an evidence-equivalence checker.

## Enforced limits and failures

| Field | Default and hard ceiling |
|---|---:|
| Associations | 128 |
| Records | 512 |
| Targets per association | 32 |
| Counters per record | 16 |
| Each identity, revision, token, relationship, counter name or digest | 256 UTF-8 bytes |
| Each source path, selector or artifact reference | 2,048 UTF-8 bytes |
| Serialized sidecar | 262,144 UTF-8 bytes |

`limits` may lower positive integer ceilings using keys `associations`, `records`,
`references`, `counters`, `identityBytes`, `textBytes`, `outputBytes`. Raising or
disabling a ceiling is invalid. Identity fields are rejected, never truncated or
normalized. Limits apply to the sidecar's compact JSON, excluding the result wrapper
and any formatting a report writer adds. The byte limit is checked after bounded
field copying/serialization; it is not a peak temporary-memory limit. Collections
and field ceilings bound normal-data traversal and retained output, not elapsed CPU.
Reflection on unsupported hostile proxies can execute traps or allocate; this is
not a sandbox or a deadline for arbitrary JavaScript. Throwing traps are contained
as `unavailable`; no callback API is offered.

Errors use stable codes: `invalid` (shape/value/config), `overlimit`, `stale`,
`unavailable` (owner loss, absent referenced record, or unexpected read failure),
and `duplicate`. `path` identifies the failed schema location. Exceptions and caller
objects are not retained in errors. No producer state is mutated on success or failure.

## Evidence and limits

Run only the focused pure Node tests for this assignment:

```sh
node --test --test-isolation=none --test-reporter=tap scripts/play/diagnostic-subjects.test.mjs scripts/play/diagnostic-subjects-use.test.mjs
```

Independent synthetic assembly and terrain fixtures check exact links, repeated local
IDs across scopes, independent authored revisions, pending publication, shared timing,
missing digests and changed content fingerprints. Contract tests check detachment,
UTF-8 and batch/byte limits, stale/unavailable captures, malformed data and recovery.
They establish the helper's data contract, not live capture correctness.

Browser integration, full repository checks/build/gate, production bundle evidence,
physical devices, performance and real preview reproducibility are unverified here.
No model inspector or stock runtime path was added. Integration must validate its
own adapter's before/after tokens and artifact fidelity.

The terrain inspection browser check emits `subjects.json` alongside its snapshots.
It observes the owner epoch before and after each capture, keeps the pending generation
linked to the still-current revision, and records partial tile coverage. Fixture source
and scenario hashes are observed; the source-to-subject association is declared.
The Vite development capture has no complete executable build digest and records it
as unavailable. This establishes traceability, not complete replay equivalence.
