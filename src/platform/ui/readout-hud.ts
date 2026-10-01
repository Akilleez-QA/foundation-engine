/**
 * A change-driven readout HUD ("computed only when a displayed
 * value can change; DOM writes only on change").
 *
 * A HUD is a list of slots; each slot is one element showing one or more readouts (joined by `separator`). Every frame
 * the caller passes a *version*: the values the readouts read (a state key). Then:
 *   - version, reading level and elements all unchanged → nothing is computed and nothing is written;
 *   - otherwise the context is built once, every row computes and formats (platform/ui/format), and an element is
 *     written only when its text differs from what it shows.
 * So an unchanged frame writes 0 DOM nodes, and a frame that moves one value writes only the elements that show it.
 *
 * An element is found through `target()` each frame (cheap lookups by id), so a panel that rebuilds its markup gets
 * its text again without the HUD knowing about the panel.
 */
import { formatReadout, type FormatLevel, type FormatText, type FormattableReadout } from './format';

/** A readout row as the HUD uses it. */
export interface HudReadout<C> extends FormattableReadout { compute(ctx: C): unknown }

export interface HudSlot<C> {
  /** The element this slot writes, or null when it is not on the page. */
  target: () => Element | null;
  rows: readonly HudReadout<C>[];
  /** Between the readouts of one slot. Default ' · '. */
  separator?: string;
}

export interface ReadoutHudOptions {
  text: FormatText;
  /** The reading level of the layer the HUD is on (a guardian's or expert's tool shows the detailed words). */
  level: () => FormatLevel;
  /** Number grouping locale; undefined is the browser's (see platform/ui/format). */
  locale?: () => string | undefined;
}

export interface ReadoutHud<C> {
  /**
   * One frame. `version` lists every value the rows read; `context` builds their context and is called only when
   * the version (or level) changed. Returns the number of elements written.
   */
  update(version: readonly unknown[], context: () => C): number;
  /** The text each slot would show now ('' before the first update). */
  texts(): readonly string[];
  /** Forget everything, so the next update computes and compares again (a HUD shown again after a teardown). */
  reset(): void;
}

const sameVersion = (a: readonly unknown[] | null, b: readonly unknown[]) =>
  !!a && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export function createReadoutHud<C>(slots: readonly HudSlot<C>[], opts: ReadoutHudOptions): ReadoutHud<C> {
  let version: readonly unknown[] | null = null, level: FormatLevel | null = null, locale: string | undefined;
  const texts: string[] = slots.map(() => ''), shown: (Element | null)[] = slots.map(() => null);
  return {
    update(nextVersion, context) {
      const nextLevel = opts.level(), nextLocale = opts.locale?.();
      const stale = !sameVersion(version, nextVersion) || nextLevel !== level || nextLocale !== locale;
      if (stale) {
        const ctx = context();
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          let text = '';
          for (let j = 0; j < s.rows.length; j++) {
            const r = s.rows[j];
            if (j) text += s.separator ?? ' · ';
            text += formatReadout(r, r.compute(ctx), nextLevel, opts.text, nextLocale);
          }
          texts[i] = text;
        }
        version = nextVersion; level = nextLevel; locale = nextLocale;
      }
      let writes = 0;
      for (let i = 0; i < slots.length; i++) {
        const el = slots[i].target();
        if (!stale && el === shown[i]) continue;
        shown[i] = el;
        if (el && el.textContent !== texts[i]) { el.textContent = texts[i]; writes++; }
      }
      return writes;
    },
    texts: () => texts,
    reset() { version = null; level = null; locale = undefined; texts.fill(''); shown.fill(null); },
  };
}
