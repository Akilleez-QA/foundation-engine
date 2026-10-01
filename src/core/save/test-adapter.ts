/**
 * core/save/test-adapter.ts: the save half of the test API (`window.engine.save`; ADR 0026).
 *
 * Verify scripts seed and read a running game's save through the store instead of writing Web Storage into the page:
 * the store caches what it read at start-up, so a raw write behind its back is never seen and can be flushed over.
 * A seed goes through the section's handle, so subscribers hear it and the section is written at once (a live legacy
 * section writes its legacy key in its own format).
 *
 * A section is named by its id (`inventory.items`), an old alias, or one of its legacy keys. The value is the
 * section's value, the same shape `read` returns. The composition root provides this in DEV and test builds only
 * (TEST_API); production builds do not contain it.
 */
import type { PlayerId, SaveSection, SaveStore, SectionStatus } from './section';

export interface SaveTestAdapter {
  /** Every section id the game registers. */
  sections(): string[];
  /** The section's value for `player` (default: the active player; ignored for profile and device sections). */
  read(section: string, player?: PlayerId): unknown;
  /** Replaces the section's value and writes it now. Returns the section's status after the write. */
  seed(section: string, value: unknown, player?: PlayerId): SectionStatus;
  /** The active player's profile file (what the game's export button downloads). */
  export(player?: PlayerId): unknown;
  /** Imports a profile file (its JSON text or the parsed object) into `player` (default: the active player). */
  import(file: unknown, player?: PlayerId): unknown;
  /** Writes every dirty section now. */
  flush(): unknown;
}

export function createSaveTestAdapter(store: SaveStore, sections: readonly SaveSection<any>[]): SaveTestAdapter {
  const find = (name: string, player: PlayerId): SaveSection<any> => {
    const def = sections.find(d => d.id === name || d.aliases?.includes(name))
      ?? sections.find(d => d.legacyKeys?.includes(name) || safeKeys(d, player).includes(name));
    if (!def) throw new Error(`engine.save: no section '${name}' (known: ${sections.map(d => d.id).join(', ')})`);
    return def;
  };
  const handle = (name: string, player?: PlayerId) => {
    const p = player ?? store.activePlayer(), def = find(name, p);
    return def.scope === 'player' ? store.section(def).of(p) : store.section(def);
  };
  return {
    sections: () => sections.map(d => d.id),
    read: (section, player) => handle(section, player).get(),
    seed: (section, value, player) => handle(section, player).replace(value, { now: true }),
    export: player => store.exportPlayer(player),
    import: (file, player) => store.importPlayer(typeof file === 'string' ? file : JSON.stringify(file), player),
    flush: () => store.flush('test'),
  };
}

/** A section's legacy keys for one player; a binding that cannot name them (it throws) has none. */
function safeKeys(def: SaveSection<any>, player: PlayerId): string[] {
  try { return def.legacy?.keys(def.scope === 'player' ? player : '') ?? []; } catch { return []; }
}
