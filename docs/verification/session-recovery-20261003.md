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

## Follow-up: the client-drop deadline raced the host idle timeout (D3, 2026-10-04)

After #97, `test:session-browser` failed three times in CI (runs 37152853649, 37169650361, 37171149554), each at
`timed out: b reconnecting after its own drop` with page B still `joined`.

**Cause: a race in the check, not a reconnect defect.** Playwright's offline emulation stops frames in both
directions but does not close B's open WebSocket (a standalone probe: no `close` event within 12 s, whether the page
was idle, sending, or receiving). B's pings no longer reach the host, so the host retires B's connection after its
documented idle timeout (15 s without a frame, close `idle-timeout`; the host terminates a socket that does not
finish the close handshake 1 s later). Only then does B see a close and enter `reconnecting`. An instrumented run
recorded the host still showing B connected at 14 s and B `reconnecting` at 15.0 s after `setOffline`, with
`closeReasons {"idle-timeout": 1}`. The check polled for B with the default 15 s window, which equals the idle
timeout, so a pass depended on the last poll landing a few tens of milliseconds after the deadline. Under CPU load
the close delivery and the page's update loop are later, and the poll timed out. After detection, B's reconnect,
resume and convergence behaved as documented in every run.

**Fix.** B's deadline is now derived from the bounds that decide it: the host's `idleTimeoutMs`
(`DEFAULT_SESSION_HOST_LIMITS`) plus the host's close-terminate delay (`CLOSE_TERMINATE_MS`, exported from
`scripts/host.mjs`) plus the same 15 s allowance the other polls use. A new assertion pins the mechanism: the host's
`idle-timeout` close count rises by exactly one during the drop. The step records `dropDetectedMs`. Every assertion
#97 added is unchanged, and the bounds that matter after detection still apply: B must resume within the host's
`leaveAfterMs` (10 s) and its paced retry episode, or the same-slot assertions fail.

**Runs.** CI before the fix: the MP-01 step failed 3 of the 142 CI runs that executed it after #97 (about 2%).
Locally, on Linux x86-64 with Node 22.23.3 and headless Chromium at nice 15 under
`flock ~/.cache/foundation-browser.lock`, the unchanged check passed 30 of 30 runs: 10 with 24 busy loops at nice 15,
10 pinned to 4 CPUs with 8 busy loops, and 10 pinned to 2 CPUs with 6 busy loops. The failure did not reproduce
locally, but the detection time shows why it can happen. With the fix, the check passed 15 of 15 runs pinned to 2 CPUs
with 6 busy loops. The time from `setOffline` to B's `reconnecting` was 14,849-15,063 ms. Six of the 15 runs were at or
above 15,000 ms, so they were inside or past the old window's last poll.

**Limitation recorded, not fixed.** The session client has no receive-side liveness check: it pings, but nothing
answers a ping, so a page notices a lost connection only when a close or socket error reaches it. Under offline
emulation that is the host's idle close. Under a real network loss, where no close may reach the page, detection is
left to the browser's own socket and has not been measured. Adding client liveness would be a protocol change to the
session kit and needs the creator's direction.
