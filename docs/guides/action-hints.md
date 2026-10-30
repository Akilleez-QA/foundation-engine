# Binding-derived action hints

`ctx.input.describe(localId)` returns the current description for an author-declared
press action, or `null` for an unknown ID or axis. It reads the existing input owner;
it does not maintain a second bindings store.

```ts
const hint = ctx.input.describe('inspect');
if (hint?.inContext) {
  const actionLabel = ctx.text(hint.labelKey);
  // Present actionLabel with hint.keys / hint.pad through your localized UI.
}
```

Headless tests must pass definitions explicitly: `testScene(scene, { inputs: [inspect] })`.
`GameDefinition` does not contain these definitions; without `inputs`, descriptions
return null. Inject `services.input` when testing effective remaps or modal context.

The returned object and arrays are immutable snapshots. Call again when presenting
or refreshing help after a remap. `inContext` describes the dispatcher's scope and
modal-layer filtering only. Explicitly scoped handler subscriptions may route an
action outside this declared-scope filter. It does not prove a live handler, an actionable gameplay
state, focus, device availability or a working navigation path.

Key chords and controller tokens are binding identifiers, not universally suitable
player-facing labels. Use localized sentences with placeholders and an appropriate
binding formatter. Standard pad positions must not be mislabeled as a particular
controller family's printed symbols. Browser bindings do not reveal every native
OS or accessibility remap. Touch instructions require an actual declared target or
gesture; a keyboard binding cannot imply that tapping anywhere works.

Choose when and where help appears for the application's supported profiles. This
API adds no persistent HUD, polling loop, device detector or forced phone layout.
The diagnostic fixture demonstrates an in-session remap and executes the newly
shown keyboard and controller binding. Its optional `savedControls=player` composition
also exercises the existing controls-settings module through real browser storage.
A finished Controls UI remains application work; ordinary input composition stays
storage-independent.

Run `node -r ./scripts/silent-browser.cjs scripts/play/action-hints-check.mjs` for
real-composition browser evidence. Its small formatter supports only the fixture's
declared controls and assumes a keyboard layout with I/U on physical KeyI/KeyU. It
is not a reusable glyph library or production help-lifecycle example. Browser emulation
and injected gamepad edges do not certify physical-device behavior.

The design follows the requirement to update displayed prompts after remapping in
[Xbox input guidance](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107).
[Apple controller guidance](https://developer.apple.com/videos/play/wwdc2020/10614/)
and [Steam action origins](https://partner.steamgames.com/doc/features/steam_controller/getting_started_for_devs)
illustrate the separate responsibility of matching displayed symbols to the actual
input origin. These are design references, not newly adopted runtime dependencies.

The saved-controls scenario in the same browser command waits for the existing
SaveStore to report `saved`, then reloads and executes the remapped keyboard action.
A separate browser context on the same origin retains defaults. Switching the
active player selects that player's overrides; resetting the original player and
reloading restores the current action defaults. It seeds no storage and forces no
flush. Fixture commands call the service directly, so this is persistence and
binding-dispatch evidence, not a completed remapping screen or account sync.
The default evidence directory is `playtest/action-hints`, including
`saved-controls-reloaded.png` and the `savedControls` section of `report.json`.
