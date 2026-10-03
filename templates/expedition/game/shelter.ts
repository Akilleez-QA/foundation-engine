import {defineScene} from '@engine';

type ShelterBody = typeof import('./shelter.body.mts');
let ready: ShelterBody | undefined;
const load = async () => (ready = await import('./shelter.body.mts'));

// Metadata stays discoverable; the secondary scene owns its implementation on demand.
export default defineScene({
  id: 'shelter',
  title: 'Field shelter',
  type: 'area',
  view: {camera: {position: [0, 7, 8], target: [0, 0, 0], fov: 50}, background: 0x18324b},
  body: load,
  async prepare(ctx, signal) {
    const implementation = await load();
    signal.throwIfAborted();
    await implementation.prepare(ctx, signal);
  },
  enter(ctx) {
    if (!ready) throw Error('shelter body has not loaded');
    ready.enter(ctx);
  },
  exit(ctx) {
    ready?.exit(ctx);
  },
});
