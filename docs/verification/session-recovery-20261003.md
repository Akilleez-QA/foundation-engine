# Shared-session recovery in the browser — 2026-10-03

## Scope

`npm run test:session-browser` (`scripts/play/session-check.mjs`, shared-world template) used to wait only for
`joined && players === 2` after a host restart. That condition also holds on a page's last-known copy, because the
`welcome` frame arrives before the first view, so the check never showed that the world was fresh. It also bounded
reconnect attempts for page A only, and never dropped one client while the host stayed up. This change is test and
documentation only: the session kit, the host and the template are unchanged. No runtime defect was found.

The fresh-baseline intent comes from preserved commit `87eb2da` (a `scripts/host.test.mjs` change on the session
liveness branch). That commit is not imported; the assertion is rewritten for the browser pages.

## What the check now asserts

1. **Host restart, fresh baseline.** While the host is down, both pages keep their last-known world (2 painted cells).
   After the host restarts on the same port with the same join code, and before any new action is sent, each page
   must:
   - be joined with 2 players;
   - have left the HUD's "waiting for the world" state;
   - show 0 painted cells.

   On the host side:
   - the board is empty;
   - `worldRevision` has started again at 2 (two joins on a new world; it was 7 before the restart);
   - no action has been applied;
   - both pages joined as new players (`resumed` 0), and the page roster matches the host's.

   Then one paint from A reaches both pages and the host board.
2. **Bounded reconnects on both pages.** Each page opened 1-7 session sockets to ride out the restart (observed: 1 each).
3. **Client-only drop.** Page B's browser context goes offline (Playwright `setOffline`); the host and page A stay up.
   - B reaches `reconnecting`, and the host marks B's slot away.
   - A stays joined: a step and a paint from A are applied while B is away, and B keeps its last-known world.
   - After B goes back online, B resumes the same player id and converges on 3 painted cells.
   - Host metrics: `resumed` +1, `joined` and `left` unchanged, and both slots connected.
   - B's paint from before the drop is applied once (one cell of B's color).
   - A never reconnected, and B used 1-7 session sockets.
4. Unchanged: a wrong join code is terminal after exactly one attempt; integrity stays in observe mode; there are no
   page or console errors beyond the expected refused connections while the host is down.

## Runs

The check ran on Linux x86-64 with Node 22.23.3 and headless Chromium (SwiftShader) against a loopback host
(127.0.0.1). It passed three consecutive times. Each run gave the same results: restart reconnect sockets were A 1
and B 1, the old world revision was 7 and the new one 2, and the client drop took 1 socket for B and 0 for A. No run
had page or console errors.

**Negative case:** the scene was temporarily changed to keep its old view after a reconnect (project only while
`reconnects === 0`). The check then failed at "b fresh baseline", with B still showing 2 painted cells. The change was
reverted.

## Limits

- **Loopback only.** Two browser contexts on one machine; no LAN between separate devices, WAN, TLS,
  physical-device, touch or scalability evidence.
- The client drop is Chromium network emulation, not a physical network loss.
- Playwright reports only the WebSockets the page creates. Attempts made while the context is offline may not appear
  in the socket count, so the 1-7 bound is an upper bound on observed sockets, not a full retry trace.
- The host restart reuses the same process, port and join code.
