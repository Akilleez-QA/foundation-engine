# Actor control ownership

`createControl(initial, ports)` owns one local actor's current controller, actor ID,
and generation-qualified coordinate frame. `state` is an immutable snapshot with
an increasing revision. `owns(owner, actor?)` gates character or vehicle systems.
It allocates constant state and adds no frame loop, handlers, draws, or services.

Wrap a synchronous domain operation with `transition(next, commit)`. A rejected
operation leaves the ownership snapshot, input epoch, and movement unchanged.
Successful operations publish the new owner, call the existing input service's
`cancel('owner')`, and reset the character integrator through `resetCharacterMotion`.
Held input cannot carry into a newly controlled actor; release and press again.
Pass `ctx => control.state.revision` to `cameraSystem`'s `resetRevision` option to
snap camera history on a control transfer, including short-distance transfers.

The commit callback must validate before mutation and return false without
changing its domain when rejected. This adapter cannot roll back arbitrary
caller side effects. Use the vehicles kit's validated board/exit operations;
exit placement is checked before custody changes. Reentrant transitions reject.
Cancellation/reset ports are synchronous engine adapters, not fallible network
operations. Once a domain operation succeeds, a later port exception does not
undo it or restore the old owner.

`dispose()` is idempotent, cancels input, resets motion, and permanently closes
ownership. Definitions are copied, so caller mutation cannot alter a current
frame or owner. This is local control authority, not server authority or transport.

The mechanics template uses this owner for actual ride/exit transitions, character
gating, input cancellation, and camera resets. Tests exercise the real input epoch
and character integrator, plus invalid transitions, reentry, and camera history.
