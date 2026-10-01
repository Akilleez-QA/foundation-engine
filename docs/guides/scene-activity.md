# Scene activity notifications

A creator can opt into `defineScene({ activity(ctx, facts) { … } })` to receive
synchronous lifecycle facts without waiting for another scene update. Scenes
without this hook install no additional activity observers.

`facts` is a frozen object with independent fields:

- `phase`: `active` after `enter` completes, or terminal `retired` before `exit`.
- `coverage`: `top`, `scrim`, `opaque`, or `hidden`, from the activity's layer owner.
- `documentHidden`: the scene document's current visibility state.

The initial notification follows successful entry and reads current coverage,
including a sheet opened during entry. Changes arrive through existing layer and
document events even when the frame loop has stopped. Equal facts do not notify
again. Normal retirement sends one terminal notification and removes observers;
a visit that never finishes entry does not announce activity. Retirement is fenced
before child layers can briefly uncover their departing parent.

These are observations, not gameplay commands. Graphics preview can keep drawing
beneath a covering layer, so coverage is not a precise ticker-running flag. Input
ownership can also differ. A creator decides whether a scrim pauses their game,
closes a connection, mutes audio, or does nothing. The hook does not install a
network module, scheduler or timer. It runs in the same synchronous transition;
it does not promise to run before the frame scheduler cancels its pending request.

```ts
const scene = defineScene({
  id: 'world', title: 'World',
  enter(ctx) { /* Initialize the visit's optional consumer. */ },
  activity(ctx, facts) {
    const available = facts.phase === 'active'
      && facts.coverage === 'top' && !facts.documentHidden;
    // Notify your consumer. A network consumer may require a fresh baseline
    // before allowing commands again; this callback is not that acknowledgment.
    updateAvailability(ctx, available);
  },
  exit(ctx) { /* Release creator-owned resources. */ },
});
```

Callback exceptions are reported without interrupting teardown. Callbacks are
trusted synchronous code, not preemptible tasks. Reentrant changes coalesce to the
latest facts. At most eight changed notifications are delivered in one synchronous
flush. If another change is still pending, the engine synchronously retires the
actual scene activity with reason `error`, then delivers one terminal notification
(maximum eight ordinary notifications plus one terminal). The headless owner is
likewise actually disposed. It does not invent retired facts, retain an eligible
consumer awaiting another signal, or schedule a background retry. This is explicit
failure handling for an overloaded optional hook, not a normal gameplay policy.
Do not toggle the triggering overlay indefinitely. Retirement and cleanup continue
even when the hook or error reporter throws; terminal notification cannot revive
the visit.

Headless `testScene` starts with `top` and `documentHidden: false`. Call
`test.setActivity({ coverage: 'scrim', documentHidden: false })` to deliver a
transition immediately without advancing frames. This method does not change the
harness's explicit stepping policy: `run(seconds)` remains caller-driven. Invalid
facts and transitions after disposal throw. Hook errors are recorded in
`test.activityErrors`; `dispose()` delivers retirement before `exit`, once. Tests
that need browser coverage must additionally exercise actual native layers and
visibility events; injected facts do not prove physical-device behavior.

## Successful native render notification

`defineScene({ rendered(ctx) { … } })` optionally observes a successful return from
the native renderer for the current live visit. It runs after drawing and clearing
the dirty flag, is caught/reported like a lifecycle callback, and schedules no
additional frame. It is not called for skipped draws, after visit retirement, or
by headless `testScene`; it does not certify GPU completion or physical display.

A consumer that conceals stale private canvas pixels can keep the canvas concealed
through reconnect and logical adoption, then reveal it here only if its current
activity and replica checks still permit presentation. Logical ECS replacement
alone does not prove the previous canvas contents have been replaced. This hook
reports presentation work; it grants no network, persistence or gameplay authority.

The optional [scoped-view reference consumer](network-views.md) uses these hooks to
clear disclosure during suspension and reveal a fresh view after native rendering.
That consumer selects its networking policy; the hooks impose none on other games.
