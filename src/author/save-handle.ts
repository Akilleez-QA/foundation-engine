import type {SaveStore} from '../core/save/section';
import type {SaveHandle, SaveSectionDef} from './defs';

/** Shared author boundary: keep mutation-only callbacks, forward the store's actual outcome. */
export function authorSaveHandle<T>(store: SaveStore, definition: SaveSectionDef<T>): SaveHandle<T> {
  const handle = store.section(definition.section);
  return {
    get: () => handle.get(),
    update: (fn, options) =>
      handle.update(draft => {
        fn(draft);
      }, options),
    status: () => handle.status(),
  };
}
