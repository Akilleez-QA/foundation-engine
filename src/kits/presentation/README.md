# Presentation

`@kits/presentation` gathers the finishing touches that make a game feel authored:

- screen transitions with an input lock;
- time-of-day lighting curves on a game clock;
- weather that blends between states;
- HUD counters that roll up.

Everything is pure or caller-owned and is driven by your simulation time. The kit never writes the scene: you apply
its values, for example to `ctx.view.environment`, haze, particle emitters or HUD text. The only DOM it touches is
one optional overlay element for transitions.

## Screen transitions

```ts
import { createScreenTransition, mountTransitionOverlay, lockedInput } from '@kits/presentation';

const transition = createScreenTransition({ kind: 'iris', coverSeconds: 0.35, uncoverSeconds: 0.35, center: [0.5, 0.6] });
const cover = mountTransitionOverlay(ctx.view.overlay, ctx.view.signal);   // in scene enter
// door trigger: transition.cover(ctx.time.t)
// frame system:
const s = transition.update(ctx.time.t);
if (s.reached === 'covered') { goTo(next); transition.uncover(ctx.time.t); }   // swap while covered
cover.render(transition);
// movement system: read input through the lock so a covered screen cannot be walked through
const input = lockedInput(ctx.input, () => transition.peek().locked);
```

- **Phases and lock:** the phases are `idle`, `covering`, `covered` and `uncovering`. Input is locked from the start
  of `cover` until coverage returns to 0.
- **Reversal:** calling `cover` while uncovering, or `uncover` while covering, reverses from the coverage currently
  shown, so the overlay never jumps.
- **Repeat calls:** a repeated call within the same phase does nothing. `setStyle` during a fade keeps the coverage
  shown and continues with the new durations.
- **Swap on `reached`:** `reached: 'covered'` is reported by `update`. If you call `uncover` before an `update`
  reports it, the swap point is skipped, so swap only after seeing `reached`.
- **Time:** time must not go backwards.
- **Kinds and CSS:** `transitionCss(style, coverage)` returns the styles for the overlay element. It uses smoothstep
  easing.
  - `fade`: opacity.
  - `wipe`: a hard-edged linear gradient from a chosen side.
  - `iris`: a circle closing on `center`, for example the player's projected position.
- **Colour:** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, comma `rgb()`/`rgba()`, or a named colour. Values that would
  not cover (`transparent`, `inherit`, ...) and anything else (such as `url(...)`) are refused.
- **Input lock:** `lockedInput(input, locked)` reads neutral while `locked()` is true: nothing pressed or held, axes
  at 0, pointer up and centred. Presses during the lock are dropped, not deferred.

## Time of day

```ts
const day = createDayClock({ dayLength: 1200, startFraction: 0.3 });            // 20-minute days, starting mid-morning
const sunHeight = createCycleCurve([{ at: 0.25, value: 0 }, { at: 0.5, value: 1 }, { at: 0.75, value: 0 }]);
const skyColor = createCycleCurve([{ at: 0, value: [0.05, 0.05, 0.15] }, { at: 0.5, value: [0.55, 0.7, 1] }], { interpolation: 'smooth' });
const tod = day.timeOfDay(ctx.time.t);
ctx.view.environment = { ...env, background: rgbToHex(skyColor(tod)), ambient: { ...env.ambient, intensity: 0.2 + 0.8 * sunHeight(tod) } };
```

- **`createDayClock`:** maps simulation time to a time of day in [0, 1) (0 = midnight by convention). It also gives
  the day count, and `nextAt` returns when a given time of day next occurs.
- **`createCycleCurve`:** wraps from the last key to the first and samples numbers or tuples of up to 16 numbers,
  with linear or smoothstep interpolation.
- **Redraws:** only replace the environment when the values change visibly, because each publication redraws.

## Weather

```ts
const weather = createWeatherDirector({ params: ['fog', 'rain', 'wind'], states: { clear: { wind: 0.1 }, storm: { fog: 0.6, rain: 1, wind: 1 } }, initial: 'clear' });
weather.set('storm', ctx.time.t, 20);                        // blend over 20 s
const w = weather.sample(ctx.time.t).named;                  // feed haze density, emitter rate, sway, sun dimming
```

- **States:** each named state gives a value for each parameter. Blends use smoothstep.
- **Retargeting:** changing state mid-blend starts from the values currently shown, with no jump. Setting the state
  it is already heading to does nothing, so a system may request the zone's weather every frame.
- **`progress`:** reports how far the current blend has gone.

## HUD roll-up

`createRollup({maxSeconds?, minRate?, snapDown?})` sets how a counter catches up:

- `update(target, dt)` returns the integer to show.
- It covers any difference within `maxSeconds` (default 0.6), at no less than `minRate` units per second
  (default 30).
- It snaps down when the true value decreases, unless `snapDown` is false.
- `rolling` reports whether the shown value is still catching up.

## Ownership, bounds and failure

- **Bounds:** at most 64 curve keys, 32 weather states and 32 parameters, and 16 tuple components. Times and values
  must be finite with magnitude at most 1e12. Transitions take 0–30 s.
- **Failure:** malformed input throws `RangeError` before any change.
- **Time:** time-driven helpers refuse time that goes backwards. Saving their state is the creator's job; restart
  them from your saved game time.
- **Overlay:** the element is `aria-hidden`, is removed when the visit's signal aborts (and is not created when it
  already has), and is restyled only when its CSS changes. It sets no z-index: mount it last, or style it above
  other overlay content.

## Limits

- Transitions are 2D overlays and do not cover rendering effects such as dissolves or shaders. During a transition,
  input is locked only for systems that read through `lockedInput`.
- Time-of-day curves only compute values. Sun direction, shadows and sky choice are the creator's.
- The weather director outputs parameters. Particles, fog and wind come from existing owners such as emitters, haze
  and the creator's systems.

## Evidence

`presentation.test.ts` covers:

- the transition lifecycle, including reversal, lock, instant transitions and monotonic time;
- CSS for each kind and refused styles;
- the headless overlay;
- the input lock in both states;
- the day clock, including wrap and `nextAt`;
- linear and smooth wrapping curves, the RGB helper and refused keys;
- weather blends and retargeting without jumps;
- roll-up budget, monotonicity, snap-down and small increments;
- a `testScene` composition in which a door covers, teleports while covered, uncovers and unlocks while a counter
  rolls up.

These are headless tests only. No browser or device evidence of the overlay's appearance exists.
