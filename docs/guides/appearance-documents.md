# Creator-defined appearance documents

`createAppearanceDocument` from `@kits/character` is an optional schema adapter
for the existing authored-document owner. Creators choose part names, identifiers,
parameter meanings, compatibility, supported assets and rendering. It introduces
no body taxonomy, asset registry, renderer, global identity or persistence owner.
It can be used without installing the character movement inputs.

The requirement is to edit a detached appearance candidate without changing the
accepted selection until commit. The extension seam is
`createAuthoredDocument`, paired with `createAuthoringSession` from
`@kits/authoring`. Runtime model instances continue to belong to the existing
scene model owner. The appearance document contains data only.

```ts
import { createAppearanceDocument } from '@kits/character';
import { createAuthoringSession } from '@kits/authoring';

const appearance = createAppearanceDocument({
  id: 'preview-appearance',
  version: 1,
  json: JSON.stringify({
    version: 1, parts: { form: 'box' }, parameters: { scale: 1 },
  }),
  limits: {
    maxBytes: 4096, maxNodes: 64, maxDepth: 4,
    maxParts: 8, maxParameters: 16,
  },
  validate: value => Object.keys(value.parts).length === 1
    && Object.keys(value.parameters).length === 1
    && ['box', 'sphere'].includes(value.parts.form)
    && value.parameters.scale >= 0.5 && value.parameters.scale <= 1.5,
});
const edits = createAuthoringSession(appearance, {
  maxEntries: 16, maxHistoryBytes: 64 * 1024,
});
const accepted = appearance.read();
const result = edits.preview(accepted.ticket, current => JSON.stringify({
  ...current, parts: { form: 'sphere' },
}));
if (result.status === 'prepared') {
  // A consumer can project result.candidate.value into its own preview entities.
  // appearance.read().value still holds the accepted selection.
}
edits.cancel(); // Discard the draft; consumer restores or removes preview entities.
// Another successful preview can be published with edits.commit().
// edits.undo()/redo() create new accepted revisions through the same validator.
```

The envelope has exactly `version`, `parts`, and `parameters`. Version is a
creator-selected nonnegative safe integer. Parts map nonempty keys to nonempty
string identifiers; parameters map nonempty keys to finite numbers. Empty maps
and zero part/parameter limits are valid. Extra top-level fields are rejected;
use the general authored-document API for another schema or richer value types.
The callback receives the detached, deeply frozen value only after these
structural checks. Only literal `true` accepts; promises and truthy values do not.
A validator is synchronous application code, not a sandbox or CPU deadline.

**Ownership and bounds.** The returned object is the existing
`AuthoredDocument<AppearanceValue>`, with its original prepare/publish/discard/edit
methods and exact lifetime/revision tickets. JSON byte, node and depth limits
apply before semantic validation. Part/parameter counts bound each selection;
identifier lengths are bounded by the total document byte limit. No polling or
per-frame work is added. Session history has separate entry and retained-byte
limits. Work is linear in bounded JSON size plus creator validation. Rendered
asset cost is a separate scene admission and device acceptance concern.

**Failure and cancellation.** Invalid initial or restored data throws. A
structurally or semantically invalid edit returns `rejected`; malformed JSON,
byte/structure overflow and callback exceptions throw. Neither changes accepted
data. Failed session preview retains any earlier valid draft: explicitly cancel
if the UI wants rejection to clear that draft. A history entry larger than the
session byte allowance returns `saturated`, retaining the draft and accepted
state. Stale tickets cannot publish; an external document edit makes the session
stale until `resetHistory()`. Nested edits during validation return `busy`.
Retirement during validation prevents publication. Dispose the session to discard
its candidate/history and dispose the document when its lifetime ends. These
operations do not clean up application entities; the consumer owns its preview
entity lifetime and must release it on cancellation, replacement and scene exit.

**Restore and migration.** Persist `appearance.read().json` in an existing save
section or coherent application envelope. Restoration calls the same factory with
the current expected version and validator. Unknown versions fail instead of
silently loading defaults. Creators explicitly migrate old JSON before intake;
keep the previous save if migration or validation fails. Restoring creates a new
lifetime, so old tickets are invalid even when document IDs match. A document
commit is in-memory publication, not a disk acknowledgement or network authority.
Use the existing save handle for durability and report its failure state. If
appearance must commit with custody or another fact, stage the combined
application envelope instead of presenting independent commits as atomic.

**Rendering and evidence.** Project accepted or preview values through ordinary
scene entities or scene-owned models. Reconcile only when the corresponding
snapshot changes. Keep accepted and preview identities distinguishable, and
release obsolete preview resources through their existing owner; a rendering
failure must not alter accepted document data. This helper does not merge
skeletons, retarget animation, validate sockets or reserve equipment. Its executable
consumer in `src/kits/character/appearance.test.ts` exercises preview, compatibility
rejection, cancel, commit, undo/redo and restore, plus malformed input, bounds,
mutation, stale tickets, reentry and retirement. Those tests establish data and
lifetime behavior; they do not certify visual quality, mobile layout, physical
device performance or arbitrary creator callbacks.
