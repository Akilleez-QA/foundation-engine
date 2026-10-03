import {label, type LocalizedLabel} from '../i18n/label';
import type {Lazy} from '../registry';
import type {SceneEntry} from './handover';

/** Eager routing metadata with a lazy implementation. Preloading fetches and prepares the implementation;
 * entering still belongs to the router's current visit and its cancellation checks. */
export function lazyScene(
  meta: Pick<SceneEntry, 'id' | 'preload'> & {label: string | LocalizedLabel},
  body: Lazy<SceneEntry>,
): SceneEntry {
  return {
    ...meta,
    get label() {
      return label(meta.label);
    },
    async load() {
      const entry = await body.load();
      return {entry, value: await entry.load()};
    },
    enter(loaded, visit) {
      const {entry, value} = loaded as {entry: SceneEntry; value: unknown};
      return entry.enter(value, visit);
    },
  };
}
