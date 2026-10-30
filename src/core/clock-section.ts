/**
 * core/clock-section.ts: the player's game time on disk, section 'core.clock'. Kept apart
 * from core/clock.ts because the save registry loads at boot and the clock does not (first-load budget).
 *
 * `null` is a player whose time never started: they start at the real date (ADR 0033). A player is written only once
 * their clock has run, so every existing save loads unchanged and gains no key until then. Written at flush points
 * only ('lazy'): UT is recorded every few seconds of play, never per frame.
 */
import type {SaveSection} from './save/section';

/** Persisted per player: UT (game seconds) and the last real time it was seen (ms since the Unix epoch, for catch-up). */
export interface ClockState {
  ut: number;
  lastRealMs: number | null;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export const clockSection: SaveSection<ClockState | null> = {
  id: 'core.clock',
  scope: 'player',
  version: 1,
  flush: 'lazy',
  initial: () => null,
  parse: raw => {
    if (raw === null) return null;
    const s = raw as ClockState;
    if (!s || typeof s !== 'object' || !finite(s.ut) || (s.lastRealMs !== null && !finite(s.lastRealMs)))
      throw Error('Invalid clock state');
    return {ut: s.ut, lastRealMs: s.lastRealMs};
  },
};
