import type {ActivityContext, RunningActivity} from '../core/activity/activity';
import type {LayerSpec} from '../platform/ui/layers';
import type {ReadingSheet, ReadingSheetOptions} from './defs';

/** One controller per scene visit; only the parent owns its disposer, never per toggle. */
export function createReadingSheets(
  parent: ActivityContext,
  overlay: HTMLElement,
  input: {
    canOpen(): boolean;
    cancelInput(): void;
  },
): {open(options: ReadingSheetOptions): ReadingSheet; dispose(): void} {
  let current: ReadingSheet | null = null,
    disposed = false;
  const dispose = () => {
    disposed = true;
    current?.close();
    current = null;
  };
  return {
    dispose,
    open(options) {
      if (disposed || parent.signal.aborted) throw Error('reading sheet: scene has left');
      // Capture validated ownership before any external callback or asynchronous entry.
      options = {...options};
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.id)) throw Error('reading sheet: invalid local id');
      if (
        options.element === overlay ||
        options.element.contains(overlay) ||
        options.element.ownerDocument !== overlay.ownerDocument
      ) {
        throw Error('reading sheet: element must belong to this document and cannot contain its host');
      }
      current?.close();
      if (!input.canOpen()) throw Error('reading sheet: scene does not own input');
      const life = new AbortController();
      let running: RunningActivity | null = null,
        child: ActivityContext | null = null;
      let resolve!: () => void, reject!: (error: unknown) => void;
      const ready = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      // A consumer may observe only signal; failures remain available through the original promise.
      void ready.catch(() => {});
      const finish = () => {
        if (current === handle) current = null;
        if (!life.signal.aborted) life.abort();
        resolve();
      };
      const handle: ReadingSheet = {
        signal: life.signal,
        ready,
        close() {
          if (life.signal.aborted) return;
          // Child context exists during enter, before start's promise resolves.
          if (child) child.leave('exit');
          else running?.stop('exit');
          finish();
        },
      };
      current = handle;
      try {
        input.cancelInput();
        if (life.signal.aborted || disposed || parent.signal.aborted || current !== handle) {
          finish();
          return handle;
        }
        if (!input.canOpen()) throw Error('reading sheet: scene lost input ownership');
        void parent
          .start(
            {
              id: `${parent.id}.reading.${options.id}`,
              kind: 'widget',
              enter(ctx) {
                child = ctx;
                ctx.signal.addEventListener('abort', finish, {once: true});
                if (life.signal.aborted || disposed || parent.signal.aborted || current !== handle) {
                  ctx.leave('exit');
                  return {};
                }
                try {
                  if (!input.canOpen()) throw Error('reading sheet: scene lost input ownership');
                  ctx.own(() => options.element.remove());
                  overlay.append(options.element);
                  const spec: LayerSpec = {
                    id: `${ctx.runId}.sheet`,
                    kind: 'sheet',
                    element: options.element,
                    cover: 'scrim',
                    modal: 'scope',
                    initialFocus: options.initialFocus,
                    returnFocus: options.returnFocus,
                    onEscape: () => {
                      ctx.leave('exit');
                      return true;
                    },
                    onClose: () => {
                      ctx.leave('exit');
                    },
                  };
                  ctx.layer(spec);
                  return {};
                } catch (error) {
                  reject(error);
                  throw error;
                }
              },
            },
            undefined,
          )
          .then(
            run => {
              running = run;
              if (life.signal.aborted || disposed || parent.signal.aborted) run.stop('exit');
              resolve();
            },
            error => {
              reject(error);
              finish();
            },
          );
      } catch (error) {
        reject(error);
        finish();
      }
      return handle;
    },
  };
}
