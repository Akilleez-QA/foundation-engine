# Optional desktop manual authoring

This creator-owned demonstration edits two generic primitive objects. It is an optional
Vite entry, not an engine editor requirement or a game mechanic. Ordinary player builds
start from the existing root entry and do not import `tools/authoring`. The separate
`mode=view` entry reads the same accepted save data without importing the editing
controller/session or mounting the editor controls. It still uses this demonstration's
runtime composition and diagnostic API; it is not a proposed production player bundle.

The creator requirement is preview → cancel/commit → undo/redo → save/reload, with
stable authored identity and truthful save feedback. Its extension seams are
`createAuthoredDocument`, `createAuthoringSession`, `ctx.save`, the existing SaveStore
StoragePort, and the existing `createApp`/`compileGame` world/Shape renderer. No new
storage, scheduling, renderer, cache or history persistence owner is introduced.

## Launch and verify

With repository dependencies installed, run from the repository root:

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 5173
```

Open <http://127.0.0.1:5173/tools/authoring/index.html?flags=dev.silent>.
Use `&mode=view` for the editor-omitted view and `&reverse=1` to reverse allocation.
The existing repository Vite config supplies engine aliases, strings and test flags.
This page is manually launchable. Its controller regressions run with `npm test`;
`npm run test:authoring-browser` runs the separate browser workflow. The browser
workflow runs separately in CI, not inside the performance gate. The production entry is unchanged.

To run focused checks:

```sh
node --import tsx --test tools/authoring/controller.test.mjs
node scripts/play/authoring-check.mjs /tmp/foundation-authoring-browser
```

The browser runner launches an isolated, muted Chromium with the existing bench helper;
it does not access a personal browser profile or alter system sound. It drives select,
numeric typing, pointer clicks and keyboard Commit, and queries actual engine world
transforms separately from accepted document state. Expected transforms and storage
key/envelope values are handwritten in the runner rather than imported from the tool.
It writes `report.json`, `snapshots.json` and these screenshot paths:

- `/tmp/foundation-authoring-browser/preview.png`
- `/tmp/foundation-authoring-browser/reloaded.png`
- `/tmp/foundation-authoring-browser/quota-unsaved.png`
- `/tmp/foundation-authoring-browser/view-only.png`

These are intended output paths, not evidence that screenshots already exist. Inspect
the images after running. A screenshot alone does not establish correct interaction.

## Workflow and data contract

Select A or B. Enter X/Y/Z in world-space metres and rotation around Y in radians.
Y is up; there is no parent/local transform, ground alignment, snapping or implicit
unit conversion. X and Z are bounded to ±4 m, Y to ±2 m and rotation to ±2π. Those
creator bounds keep this two-object example within its fixed camera framing.

Preview creates one separate amber, thin rectangular marker through `Shape`, at the
candidate position and orientation. It is visibly larger than the accepted block; it
is not a fake DOM drawing or a mutable copy of the accepted entity. The marker and
accepted block can overlap at equal coordinates. Cancel removes it. Any input event
clears it, and invalid Preview clears an earlier candidate before reporting rejection.
Commit cannot accept stale form values. Remove immediately publishes a reversible
removal; Undo restores it and Redo removes it again. Save persists only accepted data,
never the provisional marker. Reload intentionally discards unsaved work and toggles
spawn order. Selection has no persistence semantics.

`document.mjs` defines a strict schema: document ID `manual-sample`, up to two records
with stable authored IDs A/B and incarnation zero. Runtime IDs are held only in a
separate map and never serialized. Source metadata is optional by omission: this
example neither requires source fields nor supports editing arbitrary extra fields.
The creator validator rejects duplicates, unknown fields, nonfinite numbers and
out-of-range values. The kit enforces 8 KiB document bytes, 256 nodes, depth 8,
one prepared candidate, 16 history entries and 64 KiB history. Oldest history is
evicted deterministically; an entry exceeding the byte allowance returns `saturated`
without publication. These limits bound retained data, not callback execution time.
History is visit-local and is not persisted.

`createController` is DOM-free and returns the same `select`, `preview`, `cancel`,
`commit`, `undo`, `redo`, `remove`, `save`, `checkStatus`, `recover` and `invalidate`
functions that the UI calls. Browser diagnostics expose them as
`window.authoring.commands`; there is no human/agent branch. Reload is navigation
owned by the page. In a headless integration, supply a SaveHandle-compatible section
and projection adapter; the focused tests use the real SaveStore and MemoryBackend.

The scene owns document, session, projection, UI listeners and ghost. Exit disposes
all of them; the engine visit releases renderer geometry/material resources. The
renderer uses its existing frame host to observe tool mutations and skips drawing
unchanged worlds. This example includes an empty frame system so external DOM
commands are observed; it does not claim zero idle update callbacks. No separate
animation loop or scheduler is installed.

## Publication and recovery

Document/session publication covers data and history. Projection validates **every**
next object and prepares all component initializers before changing live entities.
The explicit staging failure occurs after preparation and before application. If
projection fails after the document is accepted, that document/history remains
accepted, the world may be old or partially projected, and editing and Save are
blocked. Rebuild world retries projection from accepted data and resumes editing
only after success. There is no claim of rollback for arbitrary callbacks, renderer
failures or allocation exceptions. The browser scenario verifies old-world/accepted-
document divergence is explicit and recoverable, rather than concealing it.

One version-1 SaveStore envelope uses
`manual-authoring|device|authoring.document`. Save calls the incoming
`ctx.save(section).update(fn, {now:true})` and re-reads `get()`/`status()`.
“Saved locally” requires `saved`, an existing envelope, and equality with the current
accepted document. Untouched defaults are “Not saved yet.” Dirty/session states stay
unsaved; unavailable, quarantined and newer states have distinct feedback. A newer
section disables Save. Check status refreshes feedback after background retries.
No subscription is misrepresented as a durable-save receipt.

Quota failure is injected in the **existing StoragePort boundary**, for only the
document key. Old bytes stay identical while accepted edits and history remain in
memory. Restore the port and retry Save in that same session. A separate fresh view
reads old accepted bytes while the failed writer is still alive. Failed writes may
also be retried by SaveStore flush points; closing the page before restoring access
loses unsaved document/history. A throwing save subscriber may publish memory before
throwing: the controller retains its accepted document and re-reads feedback; it
does not promise rollback. No concurrent-writer isolation is provided. Multiple
writers have SaveStore's whole-envelope last-writer-wins behavior.

## Device and evidence record

The intended target is desktop keyboard and pointer, with a 1440×960 acceptance
viewport and a 1100×800 initial layout target. The expanded layout allocates a
340 CSS-pixel control panel plus a 24-pixel gap, outside the world; the world has
zero intended panel overlap. Below 1000 CSS pixels the panel flows below the world
and the page scrolls. This is narrow-window recovery, not phone support. Controls
use native labels, tab navigation, visible focus, disabled states and a polite live
status region. There is no camera animation or time-critical simulation under UI.
The essential region is the whole canvas containing both accepted objects and the
proposed marker; unintended UI interception there must be zero.

| Profile / evidence | Status in this handoff |
| --- | --- |
| Desktop keyboard/pointer layout, focus, interaction and view integrity | Passed in isolated Chromium 152 at 1440×960; screenshots reviewed |
| Focused Node tests | Six controller tests pass, including draining cleanup after adapter failure |
| Node syntax checks | Passed for all seven JavaScript modules/tests/runner; not runtime acceptance |
| Creator schema checks | Six focused assertions passed for valid input, duplicate IDs, nonfinite/out-of-range values and detached parsing |
| Laptop, tablet, phone, touch and gamepad | Not advertised or accepted |
| 200% text/zoom, screen reader, display scaling and long labels | Unverified |
| Desktop physical-device model, sustained timing, thermal and GPU memory | Unverified; no minimum physical model certified |
| Draws, triangles, FPS, frame tails and gate resource results | Unmeasured in this worktree |
| Read denial/quarantine/newer saves, throwing subscribers and competing tabs | Read denial is exercised by browser; newer/quarantine/subscriber behavior additionally exercised by independent headless review; competing tabs unverified |
| Production omission bundle check | Entry separation implemented; production omission checked during integration |

The shared SaveHandle adapter is used unchanged. Browser evidence establishes the
named emulated workflow, not physical-device performance or full accessibility.
Disposal drains every owned cleanup step and reports combined errors afterward.
