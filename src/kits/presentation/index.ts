/**
 * kits/presentation: screen transitions (fade, wipe, iris) with an input lock, a day clock and cyclic curves for
 * time-of-day lighting, a weather director that blends named states, and HUD counter roll-ups. Pure helpers and one
 * optional overlay element; the creator applies values to the view. Cost: no draws (the overlay is one DOM element).
 */
import {defineKit, type KitDefinition} from '../../author';

export {
  createScreenTransition,
  lockedInput,
  mountTransitionOverlay,
  transitionCss,
  type ScreenTransition,
  type TransitionKind,
  type TransitionPhase,
  type TransitionSnapshot,
  type TransitionStyle,
} from './transition';
export {
  createCycleCurve,
  createDayClock,
  createRollup,
  createWeatherDirector,
  rgbToHex,
  type CurveKey,
  type CurveValue,
  type DayClock,
  type Rollup,
  type WeatherDirector,
  type WeatherDirectorOptions,
  type WeatherSample,
} from './atmosphere';

/** Pure helpers only: listing the kit records the choice; nothing is installed. */
export function presentation(): KitDefinition {
  return defineKit({id: 'presentation'});
}
