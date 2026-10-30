# Action composition workbench

This optional desktop consumer composes existing action timing, swept queries,
creator policies, resource arithmetic, temporary modifiers and presentation. It is
an example of bounded extension seams, not an engine-defined combat system. The
creator may replace its geometry, arithmetic, policies, content or supported devices.

## Accepted state and lifetime

`createActionController({targets, policy?})` owns one session. Its AuthoredDocument
publishes each accepted resource delta together with an immutable receipt. This is
session acceptance, not a save: there is no SaveStore, reload recovery, network
authority, or cross-session exactly-once guarantee. Scene exit retires the owner.
`read()` does not advance time or resolve actions.

`admit({id,target,amount,readyAt,expiresAt})` captures the current target binding and
relevant facts. Immediate and delayed requests use the same resolution path.
`resolve(id)` checks accepted receipts first; exact retry returns the original result
even after the target disappears. Reusing an admitted ID with a different payload
conflicts. IDs remain reserved, including cancelled and expired actions.

The target adapter captures actual entity identity, binding token, component
identity, revision, position, radius and enabled state. The native sample accepts
these facts as own data properties; accessor-backed fields are rejected without
invoking their getters. Creators needing computed facts can supply their own
consistent snapshot adapter. Resolution rechecks these
facts after each creator eligibility, hit and mitigation callback and immediately
before publication. It also checks the action object/revision, authority clock,
policy revision and accepted document ticket. Same-component scalar mutation is
stale. A rejected target may be retried only if its original captured facts remain
current; replacing a binding requires a fresh action identity.

Policies receive `{target,action,policyRevision,values,accepted}`. `eligible` and
`hit` must return literal booleans; `mitigate(amount,context)` returns a finite
number between zero and its supplied amount. The example policy checks enabled
state, queries a swept sphere from the origin to the selected target, and applies
no mitigation. These are authored sample choices. False eligibility or a miss
produces a refused diagnostic, not an accepted zero-value receipt. A zero amount
with true eligibility and hit can be accepted.

Callback reentry may cancel, advance time, replace policy or change temporary
inputs; such changes invalidate the in-flight proposal. Recursive admission or
resolution refuses as busy. Retirement revokes publication immediately and releases
owners after an in-progress capture unwinds. The adapter cannot undo arbitrary
external side effects performed by creator callbacks.

## Policy inputs, clocks and presentation

`applyEffect(input, policy)` uses the existing timed-effect owner. The caller must
select replace, stack or reject semantics. The exact returned `effect.handle` is
required by `cancelEffect`; a copied handle or the handle of a replaced same-key
effect cannot remove its replacement. Temporary contributions modify the example's
`amount` multiplier, initially 1. They affect future resolutions, not prior receipts.
They are independent policy inputs, not a second consequence store or part of a
secret multi-owner transaction.

`advance(time)` takes a finite monotonic caller clock. Transactional effect expiry
runs first; if its arithmetic fails, neither effect time nor action time advances.
Action expiry wins at its exact deadline. `cancel(id)` stops future acceptance but
does not undo accepted resource changes.

The separate presentation adapter owns marker advancement, seek, cue admission and
cancellation. It cannot call acceptance on behalf of a cue. Missing media, refused
cue allocation, skipped seek markers and refused presentation catch-up do not undo
accepted results. Presentation time is explicitly independent of authority time.
A presentation overload preserves its marker cursor; it does not roll back an
already advanced authority clock. Retained scene callbacks must use the retired
owner's methods, which refuse after disposal.

## Bounds and overload

The finite sample admits four live target bindings and retains 32 action identities
and receipts for the session. It has four temporary effects and eight total modifier
rows; the independent presentation path permits 16 marker occurrences per advance.
The accepted document uses 128 KiB, 16,384 JSON nodes and depth 24. Resource values range
from 0 to 100; overflow refuses atomically. These numbers are sample policies, not
universal game rules. Admission refusals preserve prior accepted state; no budget
is silently raised or terminal receipt pruned. Work-count bounds do not measure a
CPU deadline or certify physical-device performance.

## Evidence scope

The focused controller tests cover immediate/delayed acceptance, stale binding and
scalar facts, every creator callback boundary, cancellation/expiry/reentry, retained
receipt retry, exact effect handles, policy replacement, effect arithmetic failure,
capacity refusal and scene retirement. Native scene and presentation evidence is
recorded separately by the workbench browser check. A passing headless controller
test alone proves neither rendered-cue behavior nor physical-device performance.

The integrated implementation includes controller and adapter revisions `afb6dca`
and `2232acb` passed 23 focused regressions, including post-target-callback retirement
and accessor refusal. The native browser run at `4aa2a29` failed reopening controls
after scene retirement: the opener could be used before scene activation completed.
Repair `084124a` gates the opener and runner on completed activation. Its exploratory
run passed, followed by final committed-head browser and all seven template gates
at `c245896`; PR #117 integrated the result at `2aabe49`.
See the [acceptance ledger](upgrade-acceptance-ledger.md) for subsequent evidence.

Run `npm run test:action-workbench-browser`; reports and screenshots are written to
`playtest/action-workbench`. The optional [tool README](../../tools/action-workbench/README.md)
describes native controls. The selected profile is desktop keyboard/pointer at
1440×960. These checks do not certify phones, tablets, physical controllers, thermal
behavior, GPU timing or multiplayer.

### Integration checkpoint — PR #117

Integrated at `2aabe49` after candidate `c245896` passed its final native desktop
browser and all seven template gates: 1,830 tests, 129 performance checks, no
enforced breaches/regressions/inconclusive checks, and four advisory software-GL
heap warnings. Combined main tests and build passed. Earlier failed browser
observations above remain historical evidence; the scene activation repair is
included. This does not certify physical devices, durable action saves or networking.
