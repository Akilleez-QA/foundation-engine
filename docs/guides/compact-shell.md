# Optional compact shell menu

A custom module composition can select `shellModule({ home, menuPresentation:
'compact' })`. Omitting the option (or selecting `'expanded'`) keeps the existing
header and native Settings dropdown. The stock `layerModules(...)` convenience
composition continues to use expanded presentation. Replace its `platform.shell`
module with your configured `shellModule` in a custom composition; do not install
two shell modules.

This is an explicit creator choice. There are no built-in width thresholds, device
names, quality changes, or inferred mobile support. A creator can use compact
presentation on any selected edition or use another shell entirely.

Compact presentation keeps the registry's existing controls and event handlers.
Sound and Graphics remain the same registered elements, in the same order. The
Settings summary is the activation path (pointer/touch or native keyboard
activation). Setting the underlying details element's `open` property does not
open the compact panel; its raw dropdown remains hidden. Code should activate the
control rather than manipulate details state.

The compact panel is a page-modal layer owned by the existing layer manager.
Opening cancels held input and its scrim coverage pauses covered scene work.
Back/Escape or Close returns focus to Settings. Selecting a row closes this
panel before that row's handler runs, allowing Graphics to open as its own modal.
Navigation and module teardown close the panel. No additional clock or input
poller is created.

Only the opted-in compact presentation sets 48 CSS-pixel minimum touch targets.
It keeps Close outside the scrolling menu content, bounds the panel within the
viewport's safe insets, and permits labels to wrap. This does not guarantee that
arbitrary custom control content or extreme text settings will fit.

`scripts/play/compact-shell-check.mjs` exercises the real shell registry, Sound
setting and lazily installed Graphics screen over a diagnostic world. It checks
390×844 and 844×390 compact presentation, doubled base text size, control bounds,
held input, pause/resume, Back and focus return; an expanded 1280×800 case checks
that the compact presentation is absent. Browser evidence is not physical touch,
controller, visual quality or application playability certification. Creators
choose supported configurations and verify their own content and required tasks.

Run the isolated browser diagnostic after preparing the normal generated sources:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/compact-shell-check.mjs
```

Reports and screenshots default to `playtest/compact-shell`; pass an output
directory as the first argument to override it. The report records the current
Git revision and actual dirty-worktree state.

The compact controller is loaded dynamically only when this presentation is
selected. Expanded composition keeps synchronous installation and does not
statically import the compact controller. The lazy helper owns compact configuration and replacement lifetimes; the eager
registry only exposes menu availability. Application composition normally uses
`shellModule` to perform that loading. This is a code-loading boundary, not a
claim of a measured bundle reduction.
