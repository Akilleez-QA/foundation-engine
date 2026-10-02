# Optional network admission

Foundation's network seam separates command intake, raw browser transport and a
reference host. Creators choose the transport, identity provider, command schema,
authorization rules and application consequences. None is installed by the engine
boot sequence. The workbench's two counters are diagnostic policies, not mandatory
game entities or an inventory, movement or combat protocol.

## Owners and boundaries

| Owner | Supplied by creator or adapter | Responsibility | Explicitly outside its contract |
| --- | --- | --- | --- |
| [Network intake](../../src/kits/network/README.md) | Finite limits, monotonic time, authentication, current authorization, dispatch and transport ports | Exact connection lifetimes, detached bounded JSON, pending-auth admission, fair bounded dispatch, revocation and cleanup | Identity service, remote I/O cancellation, simulation, replication, persistence |
| [Browser transport](network-transport.md) | Endpoint, optional subprotocols and finite message/queue/buffer limits | One native text WebSocket, bounded application intake, explicit drain/send/dispose and terminal loss | Protocol parsing, incoming native backpressure, acknowledgments, retry or reconnect |
| [Reference host](../../tools/network-workbench/README.md) | Operator-issued fixture credentials and two sample target policies | Maintained framing, byte/rate limits, independent auth deadline driver and ephemeral authorized consequences | Production account security, public deployment, durable state or exactly-once commands |
| Reference scene | Existing scene frame system and ordinary ECS shapes | Bounded drain, correlated results, rendering accepted facts and disposal on exit/hidden page | Authority, replicated world state, prediction or automatic recovery |

The intake can wrap another maintained server framework. The raw browser adapter
is a platform seam used by reference tooling; ordinary game code still follows the
repository's author/kit import boundaries. This milestone does not add a public
`ctx.network` service or require a particular networking framework.

## Try the reference workflow

From the repository root, run the host in one terminal:

```sh
node --import tsx tools/network-workbench/server.mjs
```

It prints a loopback endpoint and random `alpha`/`beta` fixture credentials to the
trusted operator. Keep those credentials out of logs, screenshots and saved reports.
In another terminal, run `npm run dev` and open
`http://127.0.0.1:5173/tools/network-workbench/index.html?flags=dev.silent` (use the
actual Vite port if it differs). Enter the endpoint and one credential, connect,
select that principal's target, and send an amount from 1 to 5. The password field
is cleared when connecting. An accepted result changes the scene's counter shape;
the other principal's target refuses without changing either accepted result.

Use separate browser contexts for independent clients. The reference scene closes
its connection when hidden or retired; bringing it back requires an explicit new
connection. It does not retain the credential for reconnect. An authentication
message alone does not carry a counter baseline. The shape appears after this
client receives a correlated accepted command result, and is cleared when its
connection retires. Another client's changes to the same principal are not pushed
as replica updates.

A send result means local transport admission. If a connection ends while a command
is pending, its outcome is unknown to the client: the host may already have changed
its ephemeral counter. Repeating a correlation ID can apply the command again.
Do not infer durable acknowledgment, rollback or retry safety from this example.

## Reproduce the checks

```sh
node --import tsx --test src/kits/network/intake.test.ts src/platform/network/browser-transport.test.ts tools/network-workbench/server.test.mjs tools/network-workbench/client-protocol.test.mjs
npm run test:network-workbench-browser
```

The focused tests cover the pure contracts, injected browser socket behavior and
real host sockets. The browser command starts a separate host process and isolated,
muted desktop browser contexts, uses native controls, compares independent host
counter observations with accepted scene state, and writes local evidence under
`playtest/network-workbench/`. Fixture credentials must never enter those artifacts.
The CI workflow invokes this diagnostic separately before the seven-template gates.
Configuration is not evidence that a run passed; consult the
[acceptance ledger](upgrade-acceptance-ledger.md) for the current checked revision.

These checks do not establish WAN scalability, physical-device performance,
production identity security, scoped replica correctness, durable restart recovery
or prediction/reconciliation. NW02, NW03 and the device acceptance row remain
separate obligations. Existing local save, inventory and action contracts do not
acquire distributed guarantees by being called from a network dispatch port.

For optional complete scoped replacement and application credit, continue with
[network views](network-views.md). NW-02 is integrated on main by merge `ea48539`,
with work tracked in PR #122 in the private development history. Its rebased browser pass (`508edd9`) and seven-template
gate pass (`47a7e6d`, 1,965 tests and 129 performance checks) are separate evidence
from this admission slice. NW-03 durable authority/prediction and physical-device
acceptance remain open.
