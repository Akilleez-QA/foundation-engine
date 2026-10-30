# Optional saved controls

`controlsSettingsModule` is an opt-in composition module. It uses `core.save`
and `platform.input`; ordinary input installation remains storage-independent.
It supplies persistence infrastructure, not a Controls screen or device-family selection.

In the engine composition root, add it alongside the existing save and input modules:

```ts
import { controlsSettingsModule } from '../platform/input/controls-settings-module';

const controls = controlsSettingsModule({
  id: 'preferences.controls', // A stable save-section identity chosen by the creator.
  scope: 'player',           // Or 'profile' or 'device', explicitly selected.
  maxChars: 65536,           // Optional UTF-16 JSON payload budget; default 65536.
});
```

A dependent engine module declares `requires: ['platform.controls-settings']`
and reads `services.controlsSettings`. Its `get()` returns a detached immutable
snapshot. `set(overrides)` replaces the complete override record; preserve unrelated
entries with `{ ...settings.get(), 'game.action': { keys: ['q'] } }`.
`reset()` removes all saved overrides, restoring current registered defaults.
`status()` exposes the existing save status, including session-only changes when
storage fails. SaveStore owns flushing, quarantine, player switching and export rules.

An omitted `keys` or `pad` field inherits that device's author-defined bindings.
An explicit empty array unbinds that device. No controller-family swap or guessed
hardware default is applied. Unknown action IDs are retained, so temporarily absent
content can recover its remaps. Structurally malformed records are quarantined by
SaveStore on loading; invalid edits throw before saving. Key chords preserve nonempty, whitespace-free strings, matching the existing action
row validation. This does not prove that a chord is dispatchable on a device; the
adapter does not introduce a narrower keyboard grammar. Pad positions must be named
standard inputs. The configurable character
budget bounds the stored settings independently of gameplay requirements.

The persistence adapter does not enforce conflict or reachability policy. A Controls
screen can use existing `checkReach` and `bindingConflicts` to explain consequences
and apply its creator's rules. Direct `input.setOverrides()` remains an in-session
operation; persistence requires `controlsSettings.set()`.

Remapping cancels held and queued input through the existing dispatcher. A nested
remap during cancellation wins; it does not recursively notify the same cancellation
listeners. Disposing the controller removes subscriptions and rejects future writes;
it leaves the last effective bindings in place. Module ownership disposes it on
shutdown. No finished screen, physical-device certification or cross-device account
sync is implied.

`src/platform/input/controls-settings.test.ts` composes the actual input, save and
controls modules and checks persistence, player switching, malformed-data recovery,
write failure, reentrant remapping and disposal.


For browser persistence evidence, run:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/action-hints-check.mjs
```

The existing action-hints fixture explicitly composes this module with
`{ id: 'diagnostic.controls', scope: 'player' }` only for its saved-controls
scenario. It waits for ordinary debounced save completion, reloads to verify the
remap and actual keyboard dispatch, checks defaults in a fresh same-origin browser
context, switches players, and resets then reloads. Report and screenshots default
to `playtest/action-hints`; the report includes actual revision and dirty-worktree
metadata. This uses service commands, not a finished Controls UI. Browser-context
isolation does not establish cross-device/account synchronization, and no physical
keyboard/controller or mobile acceptance is claimed.
