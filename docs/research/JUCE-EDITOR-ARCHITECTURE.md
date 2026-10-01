# JUCE editor architecture: source study and engine proposals

Status: research proposals, not implemented capabilities. Recorded 2026-09-30 against Foundation Engine `852f3d7`.

The official JUCE checkout inspected for this report is pinned to [`be29c81492b6151c8ea8d14c840e1311963b3a83`](https://github.com/juce-framework/JUCE/tree/be29c81492b6151c8ea8d14c840e1311963b3a83). Findings below describe those source files, not a general guarantee about other versions. No source code or assets were copied into the engine. The proposals require independent TypeScript designs and implementation reviews. See the companion [audio and lifetime study](JUCE-AUDIO-LIFETIME.md) for separate findings.

## 1. Callback safety follows logical lifetime

`Component::SafePointer` observes component deletion. `BailOutChecker` allows checked listener dispatch to stop if a callback deletes the originating component. `Component::setName` uses this checked dispatch. The destructor detaches children rather than implicitly deleting them: presentation hierarchy and resource ownership are distinct.

Evidence: [SafePointer and BailOutChecker declarations](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_gui_basics/components/juce_Component.h#L2380), [destructor and checked notification](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_gui_basics/components/juce_Component.cpp#L495).

**Proposed adaptation:** audit the existing layer, panel and activity dispatch paths for checks before and after callbacks capable of ending an owner lifetime. Use existing cancellation signals and generation ids. A JavaScript `WeakRef` is insufficient: garbage collection does not represent logical disposal. Explicit ownership remains necessary for subscriptions, GPU resources and pending work even when DOM nodes are detached.

**Acceptance:** a listener can close its owner, change the active route, remove another listener or add a listener without subsequent stale delivery. Existing focus, pointer cancellation and accessibility behavior must remain intact. Idle paths allocate no polling loop. One shared dispatch helper should enforce the contract; individual panels should not need defensive boilerplate.

Native destructor timing and message-thread locks are not directly portable to the browser. The transferable idea is lifetime-aware dispatch, not C++ pointer machinery.

## 2. A document model can serve multiple editor views

`ValueTree::SharedObject::setProperty` suppresses unchanged writes, optionally records undo, and propagates notifications to ancestor listeners. Handles share underlying data; `createCopy()` explicitly creates an independent document. A document can therefore drive an inspector, hierarchy and preview without each view maintaining its own authoritative copy.

Evidence: [mutation and ancestor propagation](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/values/juce_ValueTree.cpp#L96), [shared-handle contract](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/values/juce_ValueTree.h#L41).

**Proposed adaptation:** a typed, versioned authoring document with stable ids and one validated mutation interface. Views subscribe to affected paths and derive presentation. Runtime simulation state and immutable published assets remain separate; editing must publish through the existing validation boundary.

**Acceptance:** two views observe the same committed revision; unchanged edits produce no notifications or renders; detached views receive none. Schema errors reject before mutation. Explicit node, depth, payload and observer-work bounds prevent an editor document from introducing unbounded frame work. A new inspector should register its schema and view without changing shared mutation code. Migration and serialization fixtures must prove round trips and readable failure rather than silent defaulting.

Avoid adopting untyped property bags or recursive whole-tree notifications merely because the source supports them. Browser worker consumers need serializable snapshots or patches, not shared mutable object handles.

## 3. Undo should correspond to an editing gesture

`UndoManager::perform` groups actions into named transactions and lets adjacent actions coalesce. `SetPropertyAction::createCoalescedAction` preserves the initial value and latest value for repeated edits to the same property. This is useful for a drag or slider gesture that should undo as one user operation.

The implementation also provides cautionary details. Its stored-unit cap is soft because a minimum transaction count can override it. Property action size accounting omits dynamic payload sizes. A failed multi-action undo can leave partial changes, after which `UndoManager::undo` clears history; it does not provide atomic rollback.

Evidence: [action admission and coalescing](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/undomanager/juce_UndoManager.cpp#L117), [soft retention limit](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/undomanager/juce_UndoManager.cpp#L202), [property action accounting and coalescing](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/values/juce_ValueTree.cpp#L452), [undo failure handling](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/undomanager/juce_UndoManager.cpp#L254).

**Proposed adaptation:** editor-only transactions with explicit gesture boundaries, validated inverse operations, coalescing keys and hard serialized-payload admission. This must not turn irreversible saved progress or resource ledgers into undoable editor state.

**Acceptance:** a long drag preserves its first and last states without retaining every intermediate event. Cancellation restores the original document exactly. Failed compound edits and failed inverses leave the document unchanged. History capacity is a hard measured bound including payloads. New edit types implement one command contract; UI code does not mutate history internals. Undo and redo preserve visual quality and deterministic published output.

## 4. All editor controls should invoke the same commands

`ApplicationCommandManager` resolves a command target and refreshes command status. Deferred `CommandMessage` holds a weak target and checks command availability again when delivered. This separates command identity and current applicability from the control that invoked it.

Evidence: [command dispatch and status](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_gui_basics/commands/juce_ApplicationCommandManager.cpp#L184), [deferred target lifetime and availability](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_gui_basics/commands/juce_ApplicationCommandTarget.cpp#L37).

**Proposed adaptation:** editor command descriptors with stable ids, enabled/checked state, labels and lifetime-scoped invocation. Menus, toolbars, a command palette, touch controls and shortcuts consume the same descriptors. Reuse existing input ownership and layers rather than introducing another keyboard dispatcher.

**Acceptance:** every supported input route produces the same operation and enabled state. An invocation queued before a route change cannot mutate the new document. Modal coverage prevents commands reaching covered owners. Status refresh is event-driven and does not poll every frame. Adding one command should require one descriptor and implementation, with no central menu switch statement. Focus and screen-reader behavior need browser verification.

Native component ancestry and message-manager locking do not translate directly; browser focus and existing layer ownership decide the target.

## 5. Incremental synchronization is distinct from multiplayer authority

`ValueTreeSynchroniser` emits either a complete snapshot or incremental property/child changes through an abstract transport callback. Child addressing uses indices within the hierarchy. The mechanism separates change generation from transport, but does not itself establish authority, reliable ordering, conflict resolution or authentication.

Evidence: [snapshot and change serialization](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/values/juce_ValueTreeSynchroniser.cpp#L103), [public transport boundary](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/values/juce_ValueTreeSynchroniser.h#L42).

**Proposed adaptation:** revisioned editor-to-preview patches with stable entity ids, schema version, document generation and base revision. Use the existing publication owner. Reject mismatched revisions and request a bounded fresh snapshot instead of attempting an ambiguous index-based mutation.

**Acceptance:** duplicate, reordered, missing and stale patches cannot corrupt the preview; failed application is atomic; reconnect restores an exact document digest. Patch queues, snapshot size and per-update application work are bounded. Transport implementations remain replaceable behind one port. The unchanged rendered result remains the quality floor; partial application must never become visible.

## 6. Module metadata should generate tools

The module header declares id, version, license, minimum language standard and dependencies for project tooling to consume. Metadata sits beside the module instead of being repeated in every project.

Evidence: [module declaration](https://github.com/juce-framework/JUCE/blob/be29c81492b6151c8ea8d14c840e1311963b3a83/modules/juce_data_structures/juce_data_structures.h#L39).

**Proposed adaptation:** assess whether existing module and kit descriptors can generate compatibility checks, dependency diagrams and notices. Extend existing registries only where a concrete missing capability justifies it. Do not add a competing discovery system or reproduce native C++ amalgamation and platform compilation directives.

**Acceptance:** generated outputs derive from one descriptor source; missing dependencies and incompatible schema versions fail with the responsible id; adding a kit does not require edits to a global list. Metadata processing remains a build/startup activity with no frame-loop cost. Existing lazy loading and optional-kit behavior remain unchanged. Distribution notices must describe actual included dependencies rather than research references.

## Recommended sequence and decision boundary

First audit lifetime-sensitive dispatch, because it can improve current runtime reliability without introducing an editor product. Next define a minimal authoring-document consumer and transaction contract. Only then consider shared command presentation and preview patches, supported by that consumer. Module metadata improvements should follow observed duplication in existing tooling.

These are proposals, not a claim that Foundation Engine already includes an editor, undo system or collaborative authoring protocol. Each accepted implementation needs its own ADR, bounded ownership, meaningful regression evidence and browser verification where presentation or input changes. No performance budget increase or reduced visual, input or accessibility quality is justified by this study.
