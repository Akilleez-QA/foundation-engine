/**
 * platform/ui/format: the one place display units are made (readouts;
 * STD-SIM-23: "display units are converted only in the formatting layer").
 *
 * A simulation hands over SI (m, m/s, rad, a plain ratio) or a short text id; `formatValue` turns it into the
 * number a person reads, with its unit. `formatReadout` then puts that number into the readout's message, the standard
 * or the detailed one, through the i18n text function, so the words are catalogue strings and never code.
 *
 * Number grouping (`1,234`) follows `locale`. `undefined` means the browser's own locale, which is what the legacy
 * `Number.toLocaleString()` calls used, so moving a HUD here keeps its text byte for byte.
 *
 * Pure: no DOM, no clock. Knows nothing about the game (STANDARD L2: platform knows no game).
 */

/** How one display unit shows an SI value. */
export interface DisplayUnitDef {
  /** SI per display unit: the SI value is divided by it (m → km is 1000; rad → ° is π/180). */
  per: number;
  /** Appended after the number, with its own spacing (' km', '°'). */
  suffix: string;
  /** Digits after the point. */
  digits: number;
  /** Group thousands for the locale (`Math.round`, then `Intl.NumberFormat`); otherwise `toFixed(digits)`. */
  group?: boolean;
}

const RAD_PER_DEG = Math.PI / 180;

/** The display units, by id. A readout row names one of these; `displayUnitProblems` checks rows against it. */
export const displayUnits = {
  /** m → whole km, grouped: altitudes, apsides. */
  'length.km': {per: 1000, suffix: ' km', digits: 0, group: true},
  /** m → whole km, ungrouped: the engineer's radius. */
  'length.km-plain': {per: 1000, suffix: ' km', digits: 0},
  /** m/s → km/s to 2 scenes. */
  'speed.km-s-2': {per: 1000, suffix: ' km/s', digits: 2},
  /** m/s → km/s to 3 scenes. */
  'speed.km-s-3': {per: 1000, suffix: ' km/s', digits: 3},
  /** m/s → whole m/s, grouped: Δv totals. */
  'speed.m-s': {per: 1, suffix: ' m/s', digits: 0, group: true},
  /** rad → degrees to 1 scene. */
  'angle.deg-1': {per: RAD_PER_DEG, suffix: '°', digits: 1},
  /** A plain ratio to 3 scenes (eccentricity). */
  'ratio.3': {per: 1, suffix: '', digits: 3},
} as const satisfies Record<string, DisplayUnitDef>;

export type DisplayUnit = keyof typeof displayUnits;

export const isDisplayUnit = (id: string): id is DisplayUnit => Object.hasOwn(displayUnits, id);

const groupers = new Map<string | undefined, Intl.NumberFormat>();
const grouper = (locale: string | undefined) => {
  let f = groupers.get(locale);
  if (!f) groupers.set(locale, (f = new Intl.NumberFormat(locale)));
  return f;
};

/** An SI number in a display unit: `formatValue(412_345, 'length.km')` → `'412 km'`. */
export function formatValue(value: number, unit: DisplayUnit, locale?: string): string {
  const u: DisplayUnitDef = displayUnits[unit];
  const shown = value / u.per;
  return (u.group ? grouper(locale).format(Math.round(shown)) : shown.toFixed(u.digits)) + u.suffix;
}

/** Which message a reader sees: the standard or the detailed one (core/i18n `ReadingLevel`). */
export type FormatLevel = 'standard' | 'detailed';

/** The i18n text function a formatter writes through (core/i18n `t`, with the message's `{value}` hole). */
export type FormatText = (
  key: string,
  vars: Readonly<Record<string, string | number>>,
  opts: {level: FormatLevel},
) => string;

/** What `formatReadout` needs from a readout row. */
export interface FormattableReadout {
  id: string;
  /** Message keys. Each has a `{value}` hole; `<key>.none` is shown when the value is `null`. */
  format: {readonly standard: string; readonly detailed: string};
  /** A `displayUnits` id for a number; absent for a text value, which is shown as it is. */
  unit?: string;
}

/**
 * A readout's value in its message, for one reading level. A `null` value (nothing to show: no apoapsis on an escape)
 * uses the message `<key>.none`. An unknown unit is a content error and throws, so a bad row fails its test.
 */
export function formatReadout(
  r: FormattableReadout,
  value: unknown,
  level: FormatLevel,
  text: FormatText,
  locale?: string,
): string {
  const key = level === 'detailed' ? r.format.detailed : r.format.standard;
  if (value === null || value === undefined) return text(key + '.none', {}, {level});
  let shown: string;
  if (r.unit === undefined) shown = String(value);
  else if (!isDisplayUnit(r.unit)) throw new Error(`[format] readout ${r.id}: unknown display unit "${r.unit}"`);
  else if (typeof value !== 'number') throw new Error(`[format] readout ${r.id}: a ${r.unit} value must be a number`);
  else shown = formatValue(value, r.unit, locale);
  return text(key, {value: shown}, {level});
}

/** Rows naming a unit `displayUnits` does not have. */
export function displayUnitProblems(rows: readonly FormattableReadout[]): string[] {
  return rows
    .filter(r => r.unit !== undefined && !isDisplayUnit(r.unit))
    .map(r => `${r.id}: unknown display unit "${r.unit}"`);
}
