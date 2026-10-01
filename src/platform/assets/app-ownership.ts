/**
 * The app's `assets.owns()`: what `disposeOwnedTree` and model batching must never dispose.
 *
 * The composition root registers the texture and model libraries here (`assetOwners.register(library)`); session caches
 * adopt into `pageResidents`.
 *
 * Kit-level shared resources that mark themselves with `userData.shared = true` (module-lifetime geometry and material
 * caches) are answered by `flagged`; prefer adopting into `pageResidents` or a library lease.
 */
import {ownership,residents} from './ownership';

/** Page-lifetime resources: shared finishes, geometry caches, glow sprites. */
export const pageResidents=residents();
const flagged={owns:(r:unknown)=>(r as {userData?:{shared?:unknown}}).userData?.shared===true};
export const assetOwners=ownership(pageResidents,flagged);
