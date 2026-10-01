/**
 * The loading state the shell shows while a scene or a module is on its way in. Scenes load through the router's
 * handover (core/router/handover.ts), which took over `lazyActivity`'s module cache, supersession ticket,
 * retry and idle preload; it reports here through `startLoading`/`endLoading`, so the shell's loading card follows
 * it. `lazyModule` is the same for a module a scene opens on request (a minigame).
 */
import {appEvents} from '../../core/app-events';
declare module '../../core/events'{interface EngineEvents{
 /** A lazy open started waiting for its module: `label` names it, `cardAfterMs` says when its card may show. */
 'loading.started':ActivityLoadingDetail;
 /** A lazy open settled (opened, superseded or failed); `pending` loads remain. */
 'loading.settled':{pending:number};
}}
let loading=0;
/** True while a scene is on its way in: the shell between leaving one activity and showing the next is not idle. */
export const activityLoading=()=>loading>0;
export type ActivityLoadingDetail={label:string;/** ms before the loading card shows (it never shows if the load settles first). */cardAfterMs:number};
/** A scene or a minigame: the card waits 150 ms, so a module that was already fetched never flashes it. */
export const CARD_AFTER_MS=150;
/** Something named `label` started loading; call `endLoading` once when it settles. */
export function startLoading(label:string,cardAfterMs=CARD_AFTER_MS){loading++;appEvents.emit('loading.started',{label,cardAfterMs});}
export function endLoading(){loading--;appEvents.emit('loading.settled',{pending:loading});}

/**
 * A module a scene opens on request (a minigame): `load` resolves with it, showing the loading card under
 * `label` while it is on its way; `preload` fetches it quietly (when the player moves up to the panel) so the
 * card never appears. A failed load is retried on the next request; for a module file, pass `load` through
 * `recoverableImport` so the retry is a new request (Chromium remembers a failed `import()` until the page reloads).
 */
export function lazyModule<M>(load:()=>Promise<M>,label='the next scene'){
 let module:Promise<M>|undefined;
 const fetch=()=>module??=load().catch(error=>{module=undefined;throw error;});
 return {
  /** What the loading and failure cards call it. */
  label,
  load():Promise<M>{
   startLoading(label);
   return fetch().finally(endLoading);
  },
  preload(){fetch().catch(()=>{});},
 };
}

export {recoverableImport,failedChunkUrl,isChunkFailure,pageChunkRetry,type ChunkRetry} from '../../core/router/chunk-retry';
