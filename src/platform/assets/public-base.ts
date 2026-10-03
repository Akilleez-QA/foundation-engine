/**
 * platform/assets/public-base.ts: the prefix every file under `public/` is fetched with.
 *
 * Asset rows hold paths relative to `public/` (`models/x.glb`). A build may be served from the site root (`/`), from a
 * sub-path (`--base /my-game/`, GitHub Pages project sites) or from wherever its `index.html` happens to be
 * (`--base ./`, itch.io and other zip hosts). The libraries prefix variant paths with this base. A root-relative base
 * (`/`, `/my-game/`) is used as it is; a relative one is made absolute against the page's `document.baseURI`, so it
 * names the same file on the main thread, in a worker (which would otherwise resolve against its own script URL) and in
 * an `<audio>` element. Pure apart from reading the page's base URI; without a document (node tests) a relative base is
 * returned unchanged.
 */
import {PUBLIC_BASE} from '../../core/env';

const pageBase = (): string | undefined => (globalThis as {document?: {baseURI?: string}}).document?.baseURI;

/** The `public/` prefix, ending in `/`. `base` defaults to the build's (`import.meta.env.BASE_URL`). */
export function publicBase(base: string = PUBLIC_BASE, page: string | undefined = pageBase()): string {
  const prefix = !base ? './' : base.endsWith('/') ? base : base + '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(prefix) || prefix.startsWith('//'))
    throw Error('assets: the public base must be a path on this site');
  return prefix.startsWith('/') || !page ? prefix : new URL(prefix, page).href;
}

/** The URL of a file under `public/` (a path with or without its leading `/`), under {@link publicBase}. */
export function publicUrl(path: string, base?: string, page?: string): string {
  return publicBase(base, page) + path.replace(/^\/+/, '');
}
