# Optional SQLite authority storage

This tool-only reference implements the storage port used by the optional
[durable authority framework](../../docs/guides/durable-authority.md). It does not
choose a game's state, reducer, principal identities, or gameplay rules. It is
not a browser persistence backend. The optional host and desktop browser consumer
exercise this storage port; their acceptance scope is recorded below.

The adapter requires **Node >=22.13** with `node:sqlite`. This is an optional tool
requirement; the engine's existing Node >=22 declaration and browser runtime are
unchanged. SQLite APIs execute synchronously even though the port returns Promises.
No dependency installation, background writer, retry queue, or scheduler is added.

## API and ownership

`storage.mjs` exports:

- `initializeAuthorityStorage({path, initialJson, limits?})`: explicit operator
  creation of a new file and genesis checkpoint. Fails if the path already exists.
- `openAuthorityStorage({path, limits?, hooks?})`: opens an existing valid checkpoint;
  returns `configuration`, `settle()`, `read()`, `compareAndSwap(request)` and `close()`.

`limits` defaults to `{maxBytes:65536, maxNodes:4096, maxDepth:16}`. Supplied limits
must contain all three positive safe integers. Identity strings are nonempty and
at most 256 UTF16 code units. The stored envelope has exactly these top-level
fields: `version:1`, `lineage`, `schema`, `revision`, `state`, `streams`.

The adapter validates bounded JSON, top-level shape, metadata, and an array of
streams. The authority framework owns full state/input/result schemas, stream
consumption floors, receipt suffix invariants and canonical command identity.
Passing the storage boundary alone is not proof that an envelope satisfies those
higher-level invariants.

`compareAndSwap({lineage, schema, revision, json})` requires candidate lineage and
schema to match and its revision to be exactly expected revision plus one. It
revalidates the current physical checkpoint inside `BEGIN IMMEDIATE`, then checks
expected lineage/schema/revision in the same transaction as the complete-envelope
update. Exactly one row must change. Malformed or metadata-incoherent external
changes after opening are refused without overwriting their bytes.

## Small standalone example

Save this example at the repository root and run it with
`node --import tsx example.mjs`. Use a new file path in an existing trusted local
directory. Initialization belongs to an explicit operator action; do not run it
as fallback when ordinary recovery fails.

```js
import {
  initializeAuthorityStorage,
  openAuthorityStorage,
} from './tools/authority-workbench/storage.mjs';

const path = '/tmp/my-new-authority-world.db'; // Must not already exist.
const genesis = {
  version: 1,
  lineage: 'operator-created-world-v1',
  schema: 'numeric-example-v1',
  revision: 0,
  state: { value: 0 },
  streams: [],
};
await initializeAuthorityStorage({ path, initialJson: JSON.stringify(genesis) });
const storage = await openAuthorityStorage({ path });
try {
  const candidate = {
    ...genesis,
    revision: 1,
    state: { value: 1 },
    streams: [{
      id: 'trusted-principal-incarnation-a',
      through: 1,
      receipts: [{
        sequence: 1, revision: 1,
        input: { add: 1 }, result: { value: 1 },
      }],
    }],
  };
  const outcome = await storage.compareAndSwap({
    lineage: genesis.lineage,
    schema: genesis.schema,
    revision: 0,
    json: JSON.stringify(candidate),
  });
  console.log(outcome); // 'committed' on this uncontended example.
  await storage.settle();
  console.log(JSON.parse(await storage.read()));
} finally {
  storage.close();
}
```

This illustrates the storage boundary directly. An actual application should use
`createAuthorityGenesis` and the authority owner to construct and validate
checkpoints, authorize inputs, retain receipts, and interpret recovery. The
operator chooses immutable lineage/schema and initial state; initialization
requires revision zero and an empty streams array.

## Configuration, failure and recovery

Every writer sets and verifies effective WAL journal mode, FULL synchronous mode
(numeric value 2), zero busy timeout, foreign keys enabled, and trusted schema
disabled. `configuration` is a frozen report of those actual values and the
SQLite version. A conflicting writer is refused promptly; there is no automatic
retry. Opening or reading also uses zero busy timeout, so it can fail with
`database is locked` while another process holds a write lock or checkpoints the
WAL as it closes its last connection. The caller decides whether and when to retry. The schema stores one checkpoint row. Reads use a SQL byte-length guard
before transferring an oversized envelope into a JavaScript string.

CAS outcomes mean:

- `committed`: COMMIT returned successfully and no subsequent diagnostic hook failed.
- `rejected`: invalid request, CAS miss, writer contention, or failure before commit
  with transaction cleanup established. Authority recovery rules still apply.
- `unknown`: commit was invoked but its outcome could not be reported reliably, or
  transaction cleanup could not be established. Never assume this means rollback.

After `unknown`, the authority owner blocks mutation until `settle()` and physical
readback establish recoverable facts. In this specific adapter, SQL calls finish
synchronously before the CAS Promise is returned; `settle()` is therefore a
finality check, with no background write to drain. It rejects when busy or closed.
A different asynchronous/RPC adapter cannot copy this no-op barrier without a real
fencing guarantee. `read()` returns the existing JSON or throws for invalid storage;
it never returns a fabricated genesis. `close()` is synchronous and refuses while
an operation is busy.

Initialization uses exclusive file creation with mode 0600. An interrupted or
failed initialization may leave an incomplete file; ordinary open refuses it.
Opening requires an existing regular file and read-only validation before opening
for writing. The path and directory must be trusted: this is not a race-free
filesystem sandbox against adversarial path replacement. WAL sidecars belong to
the live database; do not delete them or copy only the main file as a live backup.
Envelope size limits do not certify bounded total database/WAL disk use.

An intact older database backup can pass validation. Without an external trusted
monotonic anchor, restarting from it cannot prove that a previously consumed
command was not forgotten. Backup restoration, migrations and lineage changes
require explicit operator policy; automatic rollback recovery is not provided.

`hooks.beforeCommit` and `hooks.afterCommit` are trusted synchronous fault-test
callbacks, not production lifecycle hooks. Promise-returning hooks are refused
and their rejection is drained. A before-commit failure rolls back when cleanup
succeeds; an after-commit failure reports unknown and leaves committed data for
readback. Hooks can perform arbitrary trusted work; they are not sandboxed or
CPU-preemptible.

## Verification status

Run focused tests from the repository root:

```sh
node --import tsx --test tools/authority-workbench/storage.test.mjs
```

All **12 tests passed on Node 26.8.1 / SQLite 3.53.4**, including independent SQL
readback, parent-controlled SIGKILL before and after COMMIT, a two-process
same-revision race, contention, missing/corrupt/oversized storage, mid-lifetime
corruption refusal, and asynchronous-hook rejection cleanup. Process-crash tests
are not physical power-loss, filesystem fault, or disk-full certification.

Actual Node 22.23.3 / SQLite 3.51.3 also passed all 12 storage tests. The declared
minimum Node 22.13.0 / SQLite 3.47.2 passed all 17 storage and host tests, without
skips. On Node versions below 22.13, these optional
storage tests explicitly skip with an unsupported-runtime reason; a skipped run
is not SQLite acceptance. Native browser acceptance and final integration are separate from these adapter
tests; see the acceptance ledger for their current status.


## Host and native browser consumer

`server.mjs` exports `initializeAuthorityWorkbench({directory})` for explicit
operator creation of `world.db` and a private `principals.json`, followed by
`startAuthorityWorkbench({directory,port?,autoDriver?,driverMs?})` for recovery.
The identity file persists two diagnostic principal credentials and stable streams
`a` and `b`; its mode is 0600. Starting never replaces missing/corrupt state.

Run a host against an already initialized directory with
`AUTHORITY_WORKBENCH_DIRECTORY=/path/to/directory node --import tsx tools/authority-workbench/server.mjs`.
The CLI communicates readiness and operator requests through trusted process IPC;
the automated browser runner supplies that IPC. For a manual host, import/start
it and read its returned `url` and `credentials` locally. Do not publish credentials.

The host owns one authority service independently of sockets. Authentication gives
one fresh session and control epoch; replacement retires the previous controller.
A committed checkpoint pairs world revision, numeric state and the requesting
stream's consumed prefix. Current connection and authorization are rechecked before
results or baselines are disclosed. Revocation in this diagnostic lasts for the
host lifetime; it is not a durable account/identity service.

Limits are eight connections, one queued command per peer, eight total queued
commands, 1,024 incoming bytes, 16 KiB outgoing socket buffering, three permanent
streams including the operator, and four receipts per stream. The service admits
one pending operation; busy commands are refused without a retry queue. Operator
state changes use the same authority and their own stream. Withheld disclosure
coalesces to the latest checkpoint rather than retaining a history. A timer drives
the existing intake; no second simulation clock is introduced.

The native page `tools/authority-workbench/index.html` runs through Vite. It uses
the existing scene/frame owner and browser transport, shows confirmed and predicted
markers separately, and labels their shared dynamic scale. Holding commands lets
an observer see local prediction, correction and suffix replay. Exact retry reuses
the captured sequence/input; it does not predict a new command. Covering or leaving
the scene retires prediction, socket and markers; reconnect requires a fresh trusted
baseline. Result messages are correlated with a bounded set of sent commands and do
not update confirmed state. A malformed baseline retires the current connection.
The fixture declares desktop keyboard/pointer only; it is not a phone UI template.

Run native acceptance separately from heavy gates:

```sh
npm run test:authority-workbench-browser
```

The runner initializes a temporary database, starts a separate host process and two
isolated muted Chromium contexts, compares DOM and ECS marker positions, reads SQL
independently, captures screenshots and kills the host after COMMIT before its reply.
It tests duplicate/reordered baselines, visible correction with one replayed input,
exact retry, restart with the consumed floor, scene/control retirement, explicit
scaling and malformed first-baseline recovery. CI now invokes this workflow; a
configured job is not a remote CI result. No physical device, WAN throughput or
production identity claim follows from this loopback diagnostic.


Clean native acceptance passed at `8317c69`, with seven observations and no page
or console errors. [Report and inspected screenshots](../../docs/verification/authority-20261001/README.md)
record the exact scope. NW-03 is integrated on private `main` by merge `b6fb4a3` ([PR #123](https://github.com/Akilleez-QA/foundation-engine-private-history/pull/123)). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed. DV-01 remains open; minimum phone, tablet and laptop/desktop profiles are pending creator selection. This is private integration, not a public release or physical-device certification.
