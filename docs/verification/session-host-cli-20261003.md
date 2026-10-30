# Session host CLI startup regression — 2026-10-03

## Reproduction and scope

Public main `2fb6e6918e1a5e647260854daa4c8f4b871e1b47` was checked in an isolated checkout with its own npm dependencies. On Linux x86-64 with Node 22.23.3, this command exited 1 before printing the join link:

```sh
node --import tsx scripts/host.mjs --port 0 --game templates/shared-world/game
```

The exception was `TypeError: join is not a function` at the game's path construction. The CLI's local `join` variable (the optional `--join` string) shadowed the imported `node:path` function. Both generated and supplied join-code modes were affected. Existing tests imported `startSessionServer` and therefore skipped this executable-only block.

The fix renames the CLI argument variable to `joinCodeArg`. Admission rules, transport, session ownership, liveness and gameplay protocols are unchanged. No later session-liveness candidate or framework changes are required.

## Regression evidence

`node --import tsx --test scripts/host.test.mjs` passes **6/6 tests**, with no skips, on Node 22.23.3. The two added subprocess cases launch the actual executable on an ephemeral port and:

1. Require readiness and a user-facing URL containing the actual bound port and generated/supplied code.
2. Connect a real loopback WebSocket using that printed code and require admission as `p1`.
3. Send the existing IPC operator's graceful close request, require its success reply, observe WebSocket close 1001 `host-closing`, and require process exit 0.
4. Bound readiness/shutdown waits and terminate the owned child on failure.

The new subprocess tests were also run against the original main implementation: both failed before readiness with the reproduced `join` exception. Restoring the fix makes both pass. `npm run check` on Node 22.23.3 then passes types, listed lints and one selected test file (the six host tests).

The subprocess shutdown path uses IPC so it does not depend on POSIX signal semantics. This run is Linux/Node evidence, not Windows/macOS, a browser, a physical device, LAN/WAN acceptance or a new SIGINT/SIGTERM test. No browser, full template gate or deployment was run. All owned subprocesses and sockets were closed.
