import type {JobModule} from '../../../platform/workers/job';
import {patchWireSlices, type SurfacePatchVertex, type SurfaceWire, type PatchWire} from '../surface';
export interface PatchInput {
  data: SurfaceWire;
  revision: number;
  edits: readonly SurfacePatchVertex[];
}
export const slices = (input: PatchInput) => patchWireSlices(input.data, input.revision, input.edits);
const module: JobModule<PatchInput, PatchWire> = {
  async run(input, ctx) {
    const work = slices(input);
    let next = work.next();
    while (!next.done) {
      await ctx.checkpoint();
      next = work.next();
    }
    return {output: next.value};
  },
};
export default module;
