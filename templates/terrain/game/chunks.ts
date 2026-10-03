import { defineMesh, defineSystem, Mesh, Name, Transform, type MeshData, type SceneContext } from '@engine';
import { prepareSurfacePatch, projectedSurfaceError, selectSurfaceLod, buildSurfaceChunk, prepareTerrainGeneration, createTerrainGenerationBuilder, createTerrainOwner, type TerrainGeneration, type Surface, type SurfaceChunk } from '@kits/terrain';
import { region } from './region';
import { enterScatter, scatterMesh } from './scatter';

/** Four complete 12m tiles. Near meshes stay exact; far meshes permit 35cm vertical error. */
export const VISUAL_ERROR = 0.35;
export const tiles = [
  { id: 'surface-nw', startX: 0, startZ: 0, centerX: -6, centerZ: -6 },
  { id: 'surface-ne', startX: 24, startZ: 0, centerX: 6, centerZ: -6 },
  { id: 'surface-sw', startX: 0, startZ: 24, centerX: -6, centerZ: 6 },
  { id: 'surface-se', startX: 24, startZ: 24, centerX: 6, centerZ: 6 },
] as const;
function build(tile: typeof tiles[number], stride: 1 | 2, surface: Surface = region): { data: MeshData; chunk: SurfaceChunk } {
  const chunk = buildSurfaceChunk(surface, { ...tile, cellsX: 24, cellsZ: 24, stride, maxError: VISUAL_ERROR });
  return { chunk, data: meshData(surface, chunk) };
}
function meshData(surface: Surface, chunk: SurfaceChunk): MeshData {
  const colors: number[] = [];
  for (let i = 0; i < chunk.mesh.positions.length; i += 3) {
    const x = chunk.mesh.positions[i]!, y = chunk.mesh.positions[i + 1]!, z = chunk.mesh.positions[i + 2]!;
    const s = surface.sample(x, z)!, h = Math.max(0, Math.min(1, (y + 1.4) / 5));
    colors.push(...(s.material === 1 ? [0.48, 0.52, 0.55] : [0.24 + h * 0.3, 0.3 + h * 0.26, 0.18 + h * 0.23]));
  }
  return defineMesh({ ...chunk.mesh, colors }).value;
}
// Full coverage is prepared before activation. No empty tiles while far meshes build.
export const terrainEntities = tiles.map(tile => [Name({ name: tile.id }), Transform(), Mesh(build(tile, 1).data)]);
interface TileState { desired: 1 | 2; current: 1 | 2; variants: Map<number, MeshData>; coarse?: SurfaceChunk }
const layout = tiles.map(tile => ({ key: tile.id, ...tile, cellsX: 24, cellsZ: 24, stride: 1 as const }));
const initialGeneration = prepareTerrainGeneration(region, layout);
interface State { lifetime:AbortController; preparing:boolean; tiles: TileState[]; builds: number; publications: number; closed: boolean;
  owner: ReturnType<typeof createTerrainOwner>; pending?: { builder: ReturnType<typeof createTerrainGenerationBuilder>; resolve(generation: TerrainGeneration): void; reject(error: Error): void } | undefined; views?: MeshData[] | undefined;
}
const states = new WeakMap<SceneContext['world'], State>();
export function enterChunks(ctx: SceneContext): void {
  enterScatter(ctx,region);
  states.set(ctx.world, { lifetime:new AbortController(), preparing:false, owner: createTerrainOwner(initialGeneration, { maxBytes: initialGeneration.bytes * 3 }), builds: 0, publications: 0, closed: false, tiles: tiles.map(tile => ({
    desired: 1, current: 1, variants: new Map([[1, ctx.world.get(ctx.named(tile.id)!, Mesh)!]]),
  })) });
  ctx.state.terrain = { tiles: 4, builds: 0, publications: 0, closed: false, epoch: 1, navigationEpoch: 1, strides: [1, 1, 1, 1], maxError: VISUAL_ERROR };
}
export function exitChunks(ctx: SceneContext): void {
  const state = states.get(ctx.world); if (!state) return;
  state.closed = true; state.lifetime.abort(); state.pending?.builder.cancel(); state.pending?.reject(Error('scene closed')); state.pending = undefined; state.owner.close();
  for (const tile of state.tiles) tile.variants.clear();
  states.delete(ctx.world);
  const scattered=ctx.named('surface-scatter');if(scattered!==undefined)ctx.world.despawn(scattered);
  for (const tile of tiles) { const e = ctx.named(tile.id); if (e !== undefined) ctx.world.despawn(e); }
  ctx.state.terrain = { tiles: 0, builds: state.builds, publications: state.publications, closed: true, strides: [] };
}
export const chunkSystem = defineSystem({ id: 'terrain-chunks', phase: 'frame', run(ctx) {
  const state = states.get(ctx.world); if (!state || state.closed) return;
  if (ctx.input.pressed('terrain-revise')) requestTerrainRevision(ctx);
  if(state.preparing)return;
  if (state.pending) {
    state.builds += state.pending.builder.step(1);
    const result = state.pending.builder.result;
    if (result) { state.views = result.chunks.map((c,i) => c.chunk===state.owner.current.chunks[i]?.chunk ? state.tiles[i]!.variants.get(1)! : meshData(result.surface, c.chunk)); state.pending.resolve(result); state.pending = undefined; }
    ctx.state.terrain = { ...(ctx.state.terrain as object), builds: state.builds, pendingEpoch: 2 };
    return;
  }
  if (state.owner.publish(next => {
    const entities = tiles.map(tile => ctx.named(tile.id));
    if (!state.views || entities.some(e => e === undefined)) return false;
    const views = state.views;
    const scattered=scatterMesh(next.surface), scatterEntity=ctx.named('surface-scatter');
    if(scatterEntity!==undefined)ctx.world.add(scatterEntity,Mesh(scattered.mesh));ctx.state.scatter=scattered.points;
    for (let i = 0; i < entities.length; i++) ctx.world.add(entities[i]!, Mesh(views[i]!));
    state.tiles = views.map(data => ({ current: 1, desired: 1, variants: new Map([[1, data]]) }));
    for (const [name, offset] of [['player', 0.7], ['pad-marker', 0.2]] as const) {
      const e = ctx.named(name), tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      if (tr) tr.y = next.surface.sample(tr.x, tr.z)!.height + offset;
    }
    state.views = undefined; state.publications++; return true;
  })) {
    ctx.state.terrain = { tiles: 4, builds: state.builds, publications: state.publications, closed: false, epoch: state.owner.current.epoch, navigationEpoch: state.owner.current.epoch, strides: [1, 1, 1, 1], maxError: VISUAL_ERROR };
    return;
  }
  const camera=ctx.view.camera;
  // Prepare one finite candidate per frame; no repeated generation in steady state.
  const missing=state.tiles.findIndex(s=>!s.coarse);
  if(missing>=0){const built=build(tiles[missing]!,2,state.owner.current.surface),s=state.tiles[missing]!;s.coarse=built.chunk;s.variants.set(2,built.data);state.builds++;
    ctx.state.terrain={...(ctx.state.terrain as object),builds:state.builds};return;}
  const verticalFov=Math.max(camera.fov,2*Math.atan(Math.tan((camera.minWidthFov??0)*Math.PI/360)/ctx.view.aspect)*180/Math.PI);
  const view={position:camera.position,target:camera.target,verticalFov,viewportHeight:ctx.view.overlay?.clientHeight || 800,near:0.1};
  for(const s of state.tiles)s.desired=s.coarse!.stride===1?1:selectSurfaceLod(projectedSurfaceError(s.coarse!,view),s.current);
  // Prioritize refinement. At most one finite 24x24 build and one GPU publication
  // per rendered frame; steady state performs four distance checks and no mesh allocation.
  for (const target of [1, 2] as const) for (let i = 0; i < tiles.length; i++) {
    const s = state.tiles[i]!, tile = tiles[i]!;
    if (s.current === s.desired || s.desired !== target) continue;
    const entity = ctx.named(tile.id); if (entity === undefined) continue;
    let data = s.variants.get(target);
    if (!data) { data = build(tile, target, state.owner.current.surface).data; s.variants.set(target, data); state.builds++; }
    // Swap the complete component, never hide/dispose the old view before its replacement.
    ctx.world.add(entity, Mesh(data));
    s.current = target; state.publications++;
    ctx.state.terrain = { tiles: 4, builds: state.builds, publications: state.publications, closed: false, epoch: state.owner.current.epoch, navigationEpoch: state.owner.current.epoch,
      strides: state.tiles.map(s => s.current), maxError: VISUAL_ERROR };
    return;
  }
} });

/** All gameplay queries read this one scene-owned canonical generation. */
export function currentSurface(ctx: SceneContext): Surface { return states.get(ctx.world)?.owner.current.surface ?? region; }
export function subscribeTerrainRevision(ctx: SceneContext, listener: (epoch: number) => void): () => void {
  const state = states.get(ctx.world); if (!state) throw Error('terrain scene is not active'); return state.owner.subscribe(listener);
}
/** Scripted demonstration: raise a finite ridge patch while keeping the pad and unaffected tiles unchanged. */
export function requestTerrainRevision(ctx: SceneContext): string {
  const state = states.get(ctx.world); if (!state || state.closed) return 'closed';
  if (state.owner.current.epoch >= 2 || state.pending || state.preparing) return 'stale';
  return state.owner.request(2, initialGeneration.bytes, async signal => {
    state.preparing=true;
    try {
      const previous=state.owner.current.surface, edits=[];
      for(let z=14;z<=18;z++)for(let x=12;x<=16;x++)edits.push({x,z,height:previous.vertex(x,z).y+0.5});
      const result=await prepareSurfacePatch(ctx.service('jobs'),{id:'terrain-yard',signal:state.lifetime.signal},previous,2,edits,signal);
      if(result.status!=='done'||signal.aborted||state.closed)throw Error(`terrain preparation ${result.status}`);
      ctx.state.terrainWorker=ctx.service('jobs').stats();
      const builder=createTerrainGenerationBuilder(result.patch.surface,layout,{previous:state.owner.current,patch:result.patch});
      return await new Promise<TerrainGeneration>((resolve,reject)=>{
        const abort=()=>{builder.cancel();reject(Error('cancelled'));if(state.pending?.builder===builder)state.pending=undefined;};
        signal.addEventListener('abort',abort,{once:true});
        state.pending={builder,resolve:g=>{signal.removeEventListener('abort',abort);resolve(g);},reject:error=>{signal.removeEventListener('abort',abort);reject(error);}};
        state.preparing=false;
      });
    } catch(error) {if(!state.closed&&!signal.aborted)ctx.state.terrainPreparationError=String(error);throw error;} finally {state.preparing=false;}
  });
}
