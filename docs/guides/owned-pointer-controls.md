# Optional owned pointer controls

Creators choose whether to include touch controls, their layout, labels, registered
press/hold actions and directional mapping. This adapter supplies ownership and
cancellation, not a standard game layout or an analog movement model. It creates
no animation loop. Keyboard and controller bindings remain independently usable.

## Access from creator code

These helpers are optional **platform modules**, not exports of `@engine`.
Game files cannot import `src/platform/` directly under the layer rules. Put a
reusable adapter in an explicitly chosen kit, then import that kit from the game.
For a single held or pressed button, `@kits/ui` ships `touchButton(ctx, input, { label })`
(see the [ui kit README](../../src/kits/ui/README.md#touch-buttons-for-held-actions)),
built on the adapter below. The example below is source to add to your own kit for
other surfaces, not an already shipped `@kits/touch-controls` package or a required layout.

For example, `src/kits/touch-controls/index.ts` can wrap the existing dispatcher:

```ts
import type { SceneContext } from '../../author/defs';
import { actionOf } from '../../author/ids';
import { bindPointerControl } from '../../platform/input/pointer-control';

export function touchHold(
  ctx: SceneContext, localAction: string, labelKey: string, signal: AbortSignal,
): void {
  const overlay = ctx.view.overlay;
  if (!overlay || signal.aborted) return; // Headless scenes have no overlay.
  const surface = overlay.ownerDocument.createElement('div');
  surface.className = 'touch-hold';
  surface.textContent = ctx.text(labelKey);
  // Supplement an independently accessible keyboard/controller action. This is
  // a touch-only surface, not a button promising native click/Enter semantics.
  surface.setAttribute('aria-hidden', 'true');
  const binding = bindPointerControl(surface, {
    input: ctx.service('input'), actions: [actionOf(localAction)], signal,
  });
  const remove = () => surface.remove();
  signal.addEventListener('abort', remove, { once: true });
  try { overlay.append(surface); }
  catch (error) {
    signal.removeEventListener('abort', remove);
    try { binding.dispose(); } finally { remove(); }
    throw error;
  }
}
```

`actionOf('boost')` maps the author's local input ID to the registered
`game.boost` ID. Passing bare `boost` to the platform helper is incorrect.
Declare that input with `defineInput`, include it in the game composition, and
read `ctx.input.held('boost')` or `pressed('boost')` in the existing gameplay system.
Axis definitions have separate `.neg`/`.pos` registrations; this example only
accepts a named digital input, not an analog stick.

A game scene imports only the public author API and its selected kit:

```ts
import { defineScene, type SceneContext } from '@engine';
import { touchHold } from '@kits/touch-controls';

const visits = new WeakMap<SceneContext, AbortController>();
export default defineScene({
  id: 'flight', title: 'scene.flight',
  enter(ctx) {
    const life = new AbortController();
    visits.set(ctx, life);
    try { touchHold(ctx, 'boost', 'input.boost', life.signal); }
    catch (error) {
      visits.delete(ctx);
      life.abort();
      throw error;
    }
  },
  exit(ctx) {
    const life = visits.get(ctx);
    visits.delete(ctx);
    life?.abort();
  },
});
```

The visit owns the AbortController; scene exit releases held input, pointer
capture, listeners, and the surface. Entry failure aborts partial setup too.
Do not create a controller every frame or reuse an aborted controller on re-entry.
Register the example's title/label string keys in the game's strings. Include the
surface only in creator-selected layouts, and author its placement, target size,
contrast, safe-area spacing and `touch-action: none` / `user-select: none` CSS.
This deliberately supplies no universal layout or accessibility claim: the touch
surface supplements an accessible action presentation and keyboard/controller
bindings; it does not implement mouse clicks or assistive-technology activation.

## Platform contracts

`ownActionSource(input, actionIds, device, signal?)` from the optional
`src/platform/input/owned-action-source.ts` module returns an `OwnedActionSource`
with `set(downActionIds)` and idempotent `dispose()`. The declaration snapshots
registered digital action IDs; unknown actions and analog rows are rejected.
`set([])` is neutral. Repeated identical states produce no repeated presses.
Each source is independent, even when several sources select the same action.
Dispose releases its state. After dispatcher cancellation, still-down actions
must become neutral before pressing again. Reentrant reset/disposal cannot publish
an old press into a new owner or a frame queue.

The optional producer admission helper limits concurrently owned sources to 128 by default; its
`maxOwnedSources` option accepts a positive safe integer. Acquisition above this
limit throws without retaining a source. Disposal returns capacity. Each source
maps at most the registered action count; arbitrary browser pointer IDs never
become dispatcher keys. Identity exhaustion throws rather than reusing an ID.
These are configurable infrastructure bounds, not limits on authored game content.

The optional module also exports the lower-level
`openActionSource(input, declaredActionIds, device)`, returning a fixed-slot port with `press(actionId, ownerEpoch, stillValid?)`,
`release(actionId)` and `dispose()`. Its slots are fixed at acquisition: arbitrary
action IDs are rejected, repeated accepted presses are ignored, and cancelled
slots remain blocked until released. A stale epoch cannot deliver. The validity
callback allows synchronous producers to invalidate reentrant delivery. The optional port implements declaration validation, capacity enforcement and slot
lifetime. It updates the dispatcher-owned admission record; accepted/blocked state,
epochs and delivery remain solely in the dispatcher. The numeric admission record
is created only when an optional producer is requested. The helper
adds physical edge comparison and AbortSignal lifetime. Neither optional helper is
imported by the dispatcher. Direct port users must dispose their own lifetime.
`InputActions.sourceAccess()` is an internal capability for trusted adapters,
not a creator-facing API or sandbox boundary; it exposes readonly registry/configuration, the numeric admission record and
operations, not mutable input maps. Capacity enforcement belongs to the optional
public helper; raw internal capability access is unsupported. Use the validating helpers rather than raw capability calls.

`bindPointerControl(element, { input, actions, signal, select? })` in
`src/platform/input/pointer-control.ts` is an optional DOM adapter. It accepts
**touch pointers only**, including non-primary touch contacts. Each control captures
one contact; additional contacts on that control are ignored. Separate controls
capture independently. `select(localX, localY, width, height)` may select a subset
of its declared action IDs, allowing a creator's digital directional surface.
Without `select`, all declared actions are down while the contact is held.
`leave: 'release'` releases a contact that moves outside the element's bounds (or
reports `pointerleave`), as a lift would; that contact cannot press again until a
fresh touch. The default `'hold'` keeps a captured contact wherever it moves.
`onContact(down)` is a presentation hook: `true` once a contact is captured, then
`false` when it is released for any reason; a refused capture reports nothing.

The creator sets `touch-action: none` on these explicit control surfaces before
a gesture begins, and may set `user-select: none`. The adapter does not change
page-wide browser gestures or styles. Failed pointer capture does not activate an
action. Pointer up, cancellation, lost capture, page hiding, blur, owner abort and
dispatcher cancellation clear contact ownership; an old move event cannot restart
it. The returned `dispose()` is equivalent to aborting its owner. A selector that
changes the owner, cancels or disposes the control cannot publish its stale result.
Selector errors release the contact and surface through the DOM event handler.

This follows the [W3C Pointer Events 3 Recommendation, 30 June 2026](https://www.w3.org/TR/2026/REC-pointerevents3-20260630/):
primary-pointer identity is per pointer type (§4.1.2), touch-action applies before
the gesture (§8.1), and capture is released after pointer up/cancel (§9.5).

Focused Node regressions cover source bounds, neutral gates, reentrant ownership,
independent keyboard state and pointer cleanup. The optional browser diagnostic is:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/touch-sources-check.mjs playtest/ui/touch-sources
```

It uses two simultaneous CDP touch contacts against a composed scene, exercises
movement plus a second action, independent release, modal cancellation, fresh
contact restart, owner disposal and keyboard behavior. Its JSON report and image
are Chromium emulation evidence; they do not establish physical iOS/Android
behavior, authored layout quality or touchscreen performance.
