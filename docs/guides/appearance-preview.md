# Optional appearance preview tool

This desktop tool demonstrates a creator-owned part/parameter schema through the
existing authored document, edit session, ECS/Shape renderer and SaveStore. It
edits one primitive form, scale and colour. These aesthetic choices belong to the
tool; the appearance framework does not prescribe a body taxonomy or game design.
It is not a skeletal character editor or asynchronous model-replacement adapter.

Run the normal Vite development server and open
`/tools/appearance/index.html?flags=dev.silent`. The normal player entry does not
import this tool. Run `npm run test:appearance-browser` for its isolated muted
Chromium acceptance workflow; CI runs that workflow separately from template gates.

The accepted form remains on the left while a provisional candidate appears on the
right. Form edits invalidate the previous candidate. Preview validates structural
and creator compatibility rules before projection; Cancel discards it; Commit
publishes accepted data and updates the view. Undo and Redo use existing bounded
edit history. Save writes accepted data only. Reload Saved intentionally discards
unsaved edits and history. Native controls support keyboard and pointer.

The creator schema accepts `parts.form` as box or sphere, `parameters.scale` from
0.5 through 1.5 and an integer RGB colour from 0 through 16,777,215. The appearance
envelope is version 1. The document is bounded to 4 KiB, 64 nodes, depth 5, eight
parts and eight parameters; the sample's stricter schema uses one part and two
parameters. Edit history retains 16 entries and 32 KiB. The scene owns document,
session, render entities and listeners; scene reentry creates fresh input ownership.
Accepted appearance remains in bounded page-session memory across scene transitions;
edit history and provisional previews are visit-local. Explicit Reload Saved discards
unsaved page-session data. Invalid stored appearances throw from the parser into the
existing save quarantine path, allowing the tool to initialize with defaults and
show quarantined status rather than failing scene entry.

Projection prepares component values and creates a replacement before retiring the
accepted entity. Preparation failure preserves the old view. An accepted document
and the rendered world are separate state: if projection fails after Commit, the
accepted edit remains, editing/Save are blocked and Rebuild View retries projection.
There is no rollback guarantee for arbitrary renderer/allocation exceptions. This
sample has no asset loads and does not certify failed GLTF replacement behavior.

Save uses `appearance-preview|device|appearance.profile` through the existing
StoragePort. Saved Locally requires matching accepted data, `saved` status and an
existing stored envelope. A failed write keeps accepted edits in memory and reports
Unsaved. The existing frame system compares SaveStore status and updates feedback
only on change, including automatic retry after storage recovers. It installs no
new timer or persistence owner. Closing before a failed write recovers can lose the
unsaved edits. Single-writer behavior is assumed; no cross-tab transaction isolation
or crash-durability promise is added.

The browser runner exercises native controls and keyboard Commit, rejected preview,
Cancel, Undo/Redo, Save/reload, projection failure/recovery, failed storage with old
bytes retained, automatic save recovery, scene reentry and teardown. It checks
actual ECS renderer inputs separately from accepted document state and captures
`playtest/appearance/{preview,reloaded,unsaved}.png`. Screenshots are reviewed during
acceptance; these paths describe outputs, not a claim that any unchecked run passed.

The accepted profile is desktop keyboard/pointer at 1440×960 in Chromium emulation.
Controls occupy a separate panel with no overlap over the world. Below 1000 CSS
pixels the inherited desktop tool layout stacks and scrolls; that is narrow-window
recovery, not phone or tablet acceptance. Physical GPU performance, thermal behavior,
screen readers, 200% text and full accessibility remain unverified. This tool does
not change player UI or impose desktop or phone constraints on independent games.
