import {defineModule} from '../../core/module';
import type {WorkerHost, WorkerHostOptions} from './host';
import {sizePool, PROVISIONAL_WORKER_PROFILE} from './pool-sizing';
declare module '../../core/services' {
  interface Services {
    readonly jobs: WorkerHost;
  }
}
/** One application host, loaded only when a job is requested. */
export function workerModule(options: WorkerHostOptions = {}) {
  return defineModule({
    id: 'platform.jobs',
    version: '1.0.0',
    serviceKeys: ['jobs'],
    install(s) {
      let host: WorkerHost | undefined,
        pending: Promise<WorkerHost> | undefined,
        closed = false;
      const size = sizePool(
        options.hardwareConcurrency ?? globalThis.navigator?.hardwareConcurrency,
        options.profile ?? PROVISIONAL_WORKER_PROFILE,
      );
      const get = () => {
        if (closed) return Promise.reject(Error('workers: app disposed'));
        return (pending ??= import('./host')
          .then(({createWorkerHost}) => {
            if (closed) throw Error('workers: app disposed');
            return (host = createWorkerHost({
              ...options,
              report: options.report ?? (error => s.log.error(error.message)),
            }));
          })
          .catch(error => {
            pending = undefined;
            throw error;
          }));
      };
      const facade: WorkerHost = {
        get size() {
          if (closed) throw Error('workers: app disposed');
          return size;
        },
        run: (request, signal) => get().then(owner => owner.run(request, signal)),
        stats: () =>
          host?.stats() ?? {
            workers: 0,
            running: 0,
            pending: 0,
            reservedBytes: 0,
            peakRunning: 0,
            peakReservedBytes: 0,
            workersAvailable: options.createWorker !== null && typeof Worker !== 'undefined',
          },
        dispose() {
          if (closed) return;
          closed = true;
          host?.dispose();
        },
      };
      s.provide('jobs', facade);
      return {
        dispose() {
          facade.dispose();
        },
      };
    },
  });
}
