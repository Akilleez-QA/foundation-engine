# Recipe: two players in one world in ten minutes

Two browser tabs (or two computers on your network) share one board: each player moves
a capsule and paints cells, and both see the same world. The game rules live in one
file that the browser and a small development host both run. This uses the optional
shared session in `@kits/network` ([guide](../guides/multiplayer-session.md)).

**What this is not:** an Internet multiplayer service. The host is for your machine or
your local network: unencrypted, one join code, no accounts, no matchmaking, no NAT
traversal. See [limits](#limits).

## 1. Start from the template (1 minute)

```
npm run new-game -- --template shared-world --id my-world --title "My world"
git switch -c my-world
```

Or try it without a game folder: add `-- --game templates/shared-world/game` to both
commands below.

## 2. Run the game and the host (2 minutes)

In one terminal:

```
npm run play
```

In a second terminal:

```
npm run host
```

The host prints a join code and a link such as
`http://127.0.0.1:5173/?host=8787&join=<code>#scene/world`. Open that link in two tabs.
Each tab is a player (`p1`, `p2`, up to four). Move with WASD, the arrows or a stick;
paint with Space, pad A or a tap. Paint in one tab and watch it appear in the other.

Opened without `?host=…&join=…` (for example from `npm run play`'s own link), the game
plays locally with the same rules, so tests, `play:snap` and the gate need no host.

Restarting the host makes a new code, so open the new link. To let open tabs reconnect
by themselves instead, restart with the old code: `npm run host -- --join <code>` (the
host prints that command). The world starts empty either way.

To play from another computer on the same network: `npm run play -- --host` and
`npm run host -- --lan`, then open the LAN link the host prints. Anyone on that
network who has the code can join while it runs.

## 3. Read the rules (3 minutes)

`game/session.ts` is the whole shared game (an excerpt; the file has the details):

```ts
import { defineSessionRules } from '@kits/network';

export default defineSessionRules<Action>({
  id: 'shared-world', version: 1, maxPlayers: 4,
  initial: () => ({ board: { cells: Array(SIZE * SIZE).fill(0) } }),
  join: (world, player) => ({ ...world, [player]: { x, z, color } }),
  leave: (world, player) => Object.fromEntries(Object.entries(world).filter(([id]) => id !== player)),
  action: isAction,                          // schema check, on both sides
  apply(world, player, action) { /* pure: return the next world, or the same one to ignore */ },
});
```

- The **world** is entity id to JSON fields. Keep it small: every change sends each
  player a complete copy.
- **`apply` must be pure**: no clock, no `Math.random`, no ECS. The host runs it as the
  authority; your tab runs it too, to show your own moves at once (prediction), and
  corrects itself from the host's next view.
- **Bump `version`** whenever the rules change. A host and a page with different
  versions refuse each other (`rules-mismatch`) instead of drifting apart.

## 4. Read the scene (3 minutes)

`game/world.ts` owns one session per visit (excerpts):

```ts
import { createSession, sessionEndpointFromPage } from '@kits/network';
import rules from './session';

enter(ctx) { session = createSession({ rules, endpoint: sessionEndpointFromPage() }); },
exit() { session?.dispose(); session = null; },

// A fixed system turns input into actions:
if (ctx.input.pressed('paint')) session.act({ type: 'paint' });

// A frame system drives the network and redraws only when the world changed:
session.update(ctx.time.now);
const s = session.read();
if (s.revision !== shown) { shown = s.revision; project(ctx, s.world); }
```

`s.status` is `local`, `connecting`, `joined`, `reconnecting` or `closed`; the HUD shows
it with string keys from `game.ts`. `act` is safe to call on every fixed tick: it paces
itself (30 actions per second) and returns `{status:'refused', reason:'paced'}` or
`'busy'` instead of sending more than the host accepts.

## 5. Make it yours (1 minute to start)

Change the world shape, the actions and `apply` in `session.ts`; change `project` in
`world.ts` to draw them; run `npm run check`. Your existing tests run the rules with
`testScene` in local play and against `createSessionHost` without sockets (see
`game/world.test.ts`).

## What already happens for you

- **Reconnect:** a dropped connection retries with jittered backoff and a retry budget,
  then rejoins as the same player if it is back within 10 seconds. Actions that were
  in flight are not resent.
- **Refusals that would repeat stop retrying:** a wrong join code (`auth-rejected`) or a
  rules mismatch shows "Disconnected" instead of hammering the host.
- **Integrity in observe mode:** `integrity: [...]` rules in `session.ts` are checked on
  the host for every action and audited without refusing anything. When you trust a
  rule, run `npm run host -- --integrity enforce`.
- **Bounds:** player count, connection count, frame rate, queue sizes, world and action
  size are all limited; see the [guide](../guides/multiplayer-session.md#bounds-and-overload).

## Limits

LAN and loopback only: unencrypted `ws://`, one shared join code per run, an in-memory
world that a host restart resets, no accounts, matchmaking, lobby, NAT traversal or
Internet hardening, and no WAN or physical-device evidence. The browser evidence
(`npm run test:session-browser`: join, host restart with a fresh world, one client
dropping and resuming its slot) is loopback only; LAN between devices is unverified. The template targets
desktop and laptop with keyboard, pointer and gamepad; it has no touch movement.
