import { defineModule, type EngineModule } from '../../core/module';
import type { Services } from '../../core/services';
import type { AssetDef } from '../../core/asset-def';
import type { ModelLibrary, ModelLibraryStats } from './models';
import { assetOwners } from './app-ownership';
declare module '../../core/services' { interface Services { readonly models: ModelLibrary } }
declare module '../../core/probe' { interface EngineProbes { models: ModelLibraryStats } }
/** Composition supplies the author-to-platform asset adapter; the loader stays lazy and shared. */
export function modelModule(resolve: (services: Services, id: string) => AssetDef | undefined): EngineModule {
  return defineModule({ id: 'platform.models', version: '1.0.0', serviceKeys: ['models'], install(s) {
    let library: ModelLibrary | undefined, pending: Promise<ModelLibrary> | undefined, closed = false;
    const get = () => pending ??= import('./models').then(({ createModelLibrary }) => {
      if (closed) throw Error('models: module disposed');
      return library = createModelLibrary({ def: id => resolve(s, id) });
    }).catch(error => { pending = undefined; throw error; });
    const facade: ModelLibrary = {
      model: (id, options) => get().then(lib => lib.model(id, options)),
      owns: resource => library?.owns(resource) ?? false,
      stats: () => library?.stats() ?? { fetches: {}, parses: 0, hits: 0, lateDrops: 0, disposed: 0, bytesKeptMiB: 0, residentMiB: 0, instances: 0 },
      dispose() { if (closed) return; closed = true; library?.dispose(); },
    };
    const unregister = assetOwners.register(facade); s.provide('models', facade); s.probes.register('models', () => facade.stats(), s.signal);
    return { dispose() { try { facade.dispose(); } finally { unregister(); } } };
  } });
}
