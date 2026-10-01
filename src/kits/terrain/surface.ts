/** A finite, immutable, fixed-resolution height field. Heights and rendering share one sampled grid. */
export type SurfaceLayer =
  | { readonly kind: 'radial'; readonly x: number; readonly z: number; readonly radius: number; readonly height: number; readonly material?: number }
  | { readonly kind: 'noise'; readonly amplitude: number; readonly frequency: number; readonly material?: number };
export interface SurfacePad {
  readonly x: number; readonly z: number; readonly radius: number; readonly height: number;
  /** Blend width outside radius; zero makes an abrupt vertex-level edge. */
  readonly feather?: number; readonly material?: number; readonly excluded?: boolean;
}
export interface SurfaceOptions {
  readonly id: string; readonly revision: number; readonly originX: number; readonly originZ: number;
  readonly spacing: number; readonly cellsX: number; readonly cellsZ: number; readonly seed: number;
  readonly baseHeight: number; readonly layers?: readonly SurfaceLayer[]; readonly pads?: readonly SurfacePad[];
}
/** Creator-produced row-major samples; all arrays are copied into canonical storage. */
export interface SampledSurfaceOptions extends Pick<SurfaceOptions, 'id' | 'revision' | 'originX' | 'originZ' | 'spacing' | 'cellsX' | 'cellsZ'> {
  readonly heights: ArrayLike<number>;
  readonly materials?: ArrayLike<number>;
  /** Numeric 0/1 samples, defaulting to zero. */
  readonly exclusions?: ArrayLike<number>;
}
export interface SurfaceSample {
  readonly height: number; readonly normal: Readonly<{ x: number; y: number; z: number }>;
  readonly material: number; readonly excluded: boolean;
}
export interface SurfaceRayHit { readonly x: number; readonly y: number; readonly z: number; readonly distance: number }
export interface SurfaceMesh { positions: number[]; indices: number[]; normals?: number[] }
export interface SurfaceVertex { readonly x: number; readonly y: number; readonly z: number; readonly normal: Readonly<{x:number;y:number;z:number}>; readonly material:number; readonly excluded:boolean }
export interface Surface {
  readonly id: string; readonly revision: number; readonly originX: number; readonly originZ: number;
  readonly spacing: number; readonly cellsX: number; readonly cellsZ: number;
  vertex(x: number, z: number): SurfaceVertex;
  mesh(): SurfaceMesh;
  raycast(origin: Readonly<{ x: number; y: number; z: number }>, direction: Readonly<{ x: number; y: number; z: number }>, maxDistance?: number): SurfaceRayHit | null;
  sample(x: number, z: number): SurfaceSample | null;
}
const finite = (v: number, name: string): number => {
  if (!Number.isFinite(v)) throw new RangeError(`terrain: ${name} must be finite`);
  return v;
};
const positive = (v: number, name: string): number => {
  if (finite(v, name) <= 0) throw new RangeError(`terrain: ${name} must be positive`);
  return v;
};
const integer = (v: number, name: string, max = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(v) || v < 0 || v > max) throw new RangeError(`terrain: invalid ${name}`);
  return v;
};
const smooth = (v: number): number => v * v * (3 - 2 * v);
function hash(x: number, z: number, seed: number): number {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}
function noise(x: number, z: number, seed: number): number {
  if (!Number.isSafeInteger(Math.floor(x)) || !Number.isSafeInteger(Math.floor(z))) throw new RangeError('terrain: noise coordinate out of range');
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(x - ix), v = smooth(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function axis(origin: number, spacing: number, cells: number): Float32Array {
  const result = new Float32Array(cells + 1);
  for (let i = 0; i <= cells; i++) {
    result[i] = origin + i * spacing;
    if (!Number.isFinite(result[i]) || (i > 0 && result[i]! <= result[i - 1]!)) throw new RangeError('terrain: grid collapses or overflows float32 coordinates');
  }
  return result;
}
function locate(axis: Float32Array, value: number): number {
  let lo = 0, hi = axis.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (axis[mid]! <= value) lo = mid; else hi = mid; }
  return Math.min(lo, axis.length - 2);
}
/** Synchronous finite intake; validates and owns samples without retaining creator buffers. */
export function createSampledSurface(o: SampledSurfaceOptions): Surface {
  const work = sampledSurfaceWireSlices(o);
  let next = work.next();
  while (!next.done) next = work.next();
  return fromLattice(next.value, next.value.normals);
}
/** @internal Shared canonical preparation for registered jobs and synchronous intake. */
export function* sampledSurfaceWireSlices(o: SampledSurfaceOptions): Generator<void, SurfaceWire, void> {
  const { id, revision, originX, originZ, spacing, cellsX, cellsZ, heights: inputHeights, materials: inputMaterials, exclusions: inputExclusions } = o;
  validateGrid({ id, revision, originX, originZ, spacing, cellsX, cellsZ });
  const count = (cellsX + 1) * (cellsZ + 1);
  for (const input of [inputHeights, inputMaterials, inputExclusions]) {
    if (input !== undefined && input.length !== count) throw new RangeError('terrain: sample length must match grid');
  }
  if (inputHeights === undefined) throw new TypeError('terrain: height samples are required');
  const xs = axis(originX, spacing, cellsX), zs = axis(originZ, spacing, cellsZ);
  const heights = new Float32Array(count), materials = new Uint16Array(count), exclusions = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    heights[i] = finite(inputHeights[i]!, 'sample height');
    if (!Number.isFinite(heights[i])) throw new RangeError('terrain: sample height overflows float32');
    if (inputMaterials !== undefined) materials[i] = integer(inputMaterials[i]!, 'sample material', 65535);
    if (inputExclusions !== undefined) {
      const value = inputExclusions[i];
      if (value !== 0 && value !== 1) throw new RangeError('terrain: sample exclusion must be 0 or 1');
      exclusions[i] = value;
    }
    if ((i + 1) % (cellsX + 1) === 0) yield;
  }
  const lattice = { id, revision, spacing, cellsX, cellsZ, xs, zs, heights, materials, exclusions };
  return { ...lattice, normals: yield* normalSlices(lattice) };
}
function validateGrid(o: Pick<SurfaceOptions, 'id' | 'revision' | 'originX' | 'originZ' | 'spacing' | 'cellsX' | 'cellsZ'>): void {
  if (typeof o.id !== 'string' || !o.id.trim()) throw new TypeError('terrain: id is required');
  integer(o.revision, 'revision');
  finite(o.originX, 'originX'); finite(o.originZ, 'originZ'); positive(o.spacing, 'spacing');
  integer(o.cellsX, 'cellsX', 256); integer(o.cellsZ, 'cellsZ', 256);
  if (!o.cellsX || !o.cellsZ) throw new RangeError('terrain: grid requires at least one cell');
}
export function createSurface(o: SurfaceOptions): Surface {
  validateGrid(o); integer(o.seed, 'seed', 0xffffffff); finite(o.baseHeight, 'baseHeight');
  if ((o.layers?.length ?? 0) > 64 || (o.pads?.length ?? 0) > 64) throw new RangeError('terrain: at most 64 layers and pads');
  const layers = (o.layers ?? []).map(layer => {
    if (layer.kind === 'radial') { finite(layer.x, 'layer x'); finite(layer.z, 'layer z'); positive(layer.radius, 'radius'); finite(layer.height, 'height'); }
    else if (layer.kind === 'noise') { finite(layer.amplitude, 'amplitude'); positive(layer.frequency, 'frequency'); }
    else throw new TypeError('terrain: unknown layer kind');
    if (layer.material !== undefined) integer(layer.material, 'material', 65535);
    return { ...layer };
  });
  const pads = (o.pads ?? []).map(pad => {
    finite(pad.x, 'pad x'); finite(pad.z, 'pad z'); positive(pad.radius, 'pad radius'); finite(pad.height, 'pad height');
    if (finite(pad.feather ?? 0, 'feather') < 0) throw new RangeError('terrain: feather must be nonnegative');
    if (pad.material !== undefined) integer(pad.material, 'material', 65535);
    if (pad.excluded !== undefined && typeof pad.excluded !== 'boolean') throw new TypeError('terrain: excluded must be boolean');
    return { ...pad };
  });
  const { id, revision, spacing, cellsX, cellsZ, seed, baseHeight } = o;
  const xs = axis(o.originX, spacing, cellsX), zs = axis(o.originZ, spacing, cellsZ), width = cellsX + 1;
  const heights = new Float32Array(width * (cellsZ + 1)), materials = new Uint16Array(heights.length), exclusions = new Uint8Array(heights.length);
  for (let j = 0; j <= cellsZ; j++) for (let i = 0; i <= cellsX; i++) {
    const x = xs[i]!, z = zs[j]!, n = j * width + i;
    let height = baseHeight, material = 0, excluded = false;
    for (const layer of layers) {
      let weight = 1;
      if (layer.kind === 'radial') {
        weight = 1 - smooth(Math.min(1, Math.hypot(x - layer.x, z - layer.z) / layer.radius));
        height += layer.height * weight;
      } else height += layer.amplitude * noise(x * layer.frequency, z * layer.frequency, seed);
      if (weight > 0 && layer.material !== undefined) material = layer.material;
    }
    for (const pad of pads) {
      const distance = Math.hypot(x - pad.x, z - pad.z), feather = pad.feather ?? 0;
      const weight = distance <= pad.radius ? 1 : feather > 0 ? 1 - smooth(Math.min(1, (distance - pad.radius) / feather)) : 0;
      if (weight > 0) {
        height = height * (1 - weight) + pad.height * weight;
        if (pad.material !== undefined) material = pad.material;
        if (pad.excluded !== undefined) excluded = pad.excluded;
      }
    }
    heights[n] = height;
    if (!Number.isFinite(heights[n])) throw new RangeError('terrain: generated height overflows float32');
    materials[n] = material; exclusions[n] = excluded ? 1 : 0;
  }
  return fromLattice({ id, revision, spacing, cellsX, cellsZ, xs, zs, heights, materials, exclusions });
}
interface Lattice { normals?:Float64Array; id:string; revision:number; spacing:number; cellsX:number; cellsZ:number; xs:Float32Array; zs:Float32Array; heights:Float32Array; materials:Uint16Array; exclusions:Uint8Array }
const lattices = new WeakMap<Surface, Lattice>();
const parents = new WeakMap<Surface, Surface>();
function fromLattice(lattice:Lattice,preparedNormals?:Float64Array):Surface {
  const {id,revision,spacing,cellsX,cellsZ,xs,zs,heights,materials,exclusions}=lattice, width=cellsX+1;
  const normals=preparedNormals ?? calculateNormals(lattice);
  const surface:Surface = Object.freeze({ id, revision, originX: xs[0]!, originZ: zs[0]!, spacing, cellsX, cellsZ,
    vertex(x:number,z:number):SurfaceVertex {
      integer(x,'vertex x',cellsX);integer(z,'vertex z',cellsZ);const i=z*width+x;
      return Object.freeze({x:xs[x]!,y:heights[i]!,z:zs[z]!,normal:Object.freeze({x:normals[i*3]!,y:normals[i*3+1]!,z:normals[i*3+2]!}),material:materials[i]!,excluded:exclusions[i]===1});
    },
    mesh(): SurfaceMesh {
      const positions: number[] = [], indices: number[] = [];
      for (let j = 0; j <= cellsZ; j++) for (let i = 0; i <= cellsX; i++) positions.push(xs[i]!, heights[j * width + i]!, zs[j]!);
      for (let j = 0; j < cellsZ; j++) for (let i = 0; i < cellsX; i++) { const a = j * width + i; indices.push(a, a + width, a + 1, a + 1, a + width, a + width + 1); }
      return { positions, indices };
    },
    raycast(origin: Readonly<{ x: number; y: number; z: number }>, direction: Readonly<{ x: number; y: number; z: number }>, maxDistance = Infinity): SurfaceRayHit | null {
      for (const value of [origin.x, origin.y, origin.z, direction.x, direction.y, direction.z]) finite(value, 'ray coordinate');
      if (!(maxDistance >= 0) || (maxDistance !== Infinity && !Number.isFinite(maxDistance))) throw new RangeError('terrain: invalid ray distance');
      const scale = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
      if (scale === 0) throw new RangeError('terrain: ray direction must be nonzero');
      const length = Math.hypot(direction.x / scale, direction.y / scale, direction.z / scale);
      const rx = direction.x / scale / length, ry = direction.y / scale / length, rz = direction.z / scale / length;
      let nearest = maxDistance, found = false;
      const triangle = (ia: number, ib: number, ic: number): void => {
        const ax = xs[ia % width]!, ay = heights[ia]!, az = zs[Math.floor(ia / width)]!;
        const ex = xs[ib % width]! - ax, ey = heights[ib]! - ay, ez = zs[Math.floor(ib / width)]! - az;
        const fx = xs[ic % width]! - ax, fy = heights[ic]! - ay, fz = zs[Math.floor(ic / width)]! - az;
        const px = ry * fz - rz * fy, py = rz * fx - rx * fz, pz = rx * fy - ry * fx;
        const determinant = ex * px + ey * py + ez * pz;
        if (determinant === 0) return;
        const tx = origin.x - ax, ty = origin.y - ay, tz = origin.z - az;
        const u = (tx * px + ty * py + tz * pz) / determinant;
        if (u < 0 || u > 1) return;
        const qx = ty * ez - tz * ey, qy = tz * ex - tx * ez, qz = tx * ey - ty * ex;
        const v = (rx * qx + ry * qy + rz * qz) / determinant;
        if (v < 0 || u + v > 1) return;
        const distance = (fx * qx + fy * qy + fz * qz) / determinant;
        if (Number.isFinite(distance) && distance >= 0 && distance <= nearest) { nearest = distance; found = true; }
      };
      // Traverse only cells intersected by the XZ projection. Axis coordinates are
      // the actual Float32 render lattice, not an assumed perfectly uniform grid.
      let enter = 0, exit = maxDistance;
      for (const [at, velocity, min, max] of [[origin.x, rx, xs[0]!, xs[cellsX]!], [origin.z, rz, zs[0]!, zs[cellsZ]!]]) {
        if (velocity === 0) { if (at < min || at > max) return null; continue; }
        const a = (min - at) / velocity, b = (max - at) / velocity;
        enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      }
      if (!Number.isFinite(enter) || enter > exit) return null;
      let i = locate(xs, Math.max(xs[0]!, Math.min(xs[cellsX]!, origin.x + rx * enter)));
      let j = locate(zs, Math.max(zs[0]!, Math.min(zs[cellsZ]!, origin.z + rz * enter)));
      const stepX = Math.sign(rx), stepZ = Math.sign(rz);
      for (let work = 0; work <= cellsX + cellsZ + 2; work++) {
        const a = j * width + i; triangle(a, a + width, a + 1); triangle(a + 1, a + width, a + width + 1);
        const nextX = rx === 0 ? Infinity : (xs[stepX > 0 ? i + 1 : i]! - origin.x) / rx;
        const nextZ = rz === 0 ? Infinity : (zs[stepZ > 0 ? j + 1 : j]! - origin.z) / rz;
        const next = Math.min(nextX, nextZ);
        if (next > exit || !Number.isFinite(next) || (found && nearest <= next)) break;
        if (nextX <= nextZ) i += stepX;
        if (nextZ <= nextX) j += stepZ;
        if (i < 0 || i >= cellsX || j < 0 || j >= cellsZ) break;
      }
      return found ? Object.freeze({ x: origin.x + rx * nearest, y: origin.y + ry * nearest, z: origin.z + rz * nearest, distance: nearest }) : null;
    },
    sample(x: number, z: number): SurfaceSample | null {
      finite(x, 'sample x'); finite(z, 'sample z');
      if (x < xs[0]! || x > xs[cellsX]! || z < zs[0]! || z > zs[cellsZ]!) return null;
      const i = locate(xs, x), j = locate(zs, z), dx = xs[i + 1]! - xs[i]!, dz = zs[j + 1]! - zs[j]!;
      const u = (x - xs[i]!) / dx, v = (z - zs[j]!) / dz, a = j * width + i;
      const lower = u + v <= 1;
      const ids = lower ? [a, a + 1, a + width] : [a + width + 1, a + width, a + 1];
      const weights = lower ? [1 - u - v, u, v] : [u + v - 1, 1 - u, 1 - v];
      const h0 = heights[ids[0]!]!, h1 = heights[ids[1]!]!, h2 = heights[ids[2]!]!;
      const sx = (lower ? h1 - h0 : h0 - h1) / dx, sz = (lower ? h2 - h0 : h0 - h2) / dz;
      const length = Math.hypot(sx, 1, sz);
      const dominant = weights[1]! > weights[0]! ? (weights[2]! > weights[1]! ? 2 : 1) : (weights[2]! > weights[0]! ? 2 : 0);
      return Object.freeze({ height: h0 * weights[0]! + h1 * weights[1]! + h2 * weights[2]!, normal: Object.freeze({ x: -sx / length, y: 1 / length, z: -sz / length }), material: materials[ids[dominant]!]!, excluded: ids.some((id, k) => weights[k]! > 0 && exclusions[id] === 1) });
    },
  });
  lattices.set(surface,{...lattice,normals}); return surface;
}

export interface SurfacePatchVertex { x:number; z:number; height?:number; material?:number; excluded?:boolean }
const patches=new WeakSet<SurfacePatch>();
export function isSurfacePatch(patch:SurfacePatch):boolean{return patches.has(patch);}
export interface SurfacePatch { readonly surface:Surface; readonly previous:Surface; readonly bounds:Readonly<{minX:number;minZ:number;maxX:number;maxZ:number}>; /** Exact changed render vertices, or null when only private backing changed. */ readonly dirty?: SurfacePatch['bounds'] | null }
/** Finite immutable patch; normals depend on cells incident on the changed lattice vertices. */
export function patchSurface(previous:Surface, revision:number, edits:readonly SurfacePatchVertex[]):SurfacePatch {
  const parent=parents.get(previous);
  if(parent){
    const editsOwned=captureCoreEdits(previous,edits);
    return projectSurfacePatch(previous,patchSurface(parent,revision,editsOwned.map(e=>({...e,x:e.x+1,z:e.z+1}))));
  }
  const old=lattices.get(previous); if(!old)throw Error('terrain: unknown canonical surface');
  integer(revision,'revision');if(revision<=previous.revision||edits.length<1||edits.length>4096)throw Error('terrain: invalid patch revision/size');
  const heights=old.heights.slice(),materials=old.materials.slice(),exclusions=old.exclusions.slice(),seen=new Set<number>();
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(const e of edits){integer(e.x,'patch x',old.cellsX);integer(e.z,'patch z',old.cellsZ);const i=e.z*(old.cellsX+1)+e.x;if(seen.has(i))throw Error('terrain: duplicate patch vertex');seen.add(i);
    if(e.height!==undefined){finite(e.height,'patch height');heights[i]=e.height;if(!Number.isFinite(heights[i]))throw Error('terrain: patch overflow');}
    if(e.material!==undefined){integer(e.material,'patch material',65535);materials[i]=e.material;}
    if(e.excluded!==undefined){if(typeof e.excluded!=='boolean')throw Error('terrain: invalid exclusion');exclusions[i]=+e.excluded;}
    minX=Math.min(minX,e.x);maxX=Math.max(maxX,e.x);minZ=Math.min(minZ,e.z);maxZ=Math.max(maxZ,e.z);
  }
  const patch=Object.freeze({previous,surface:fromLattice({...old,revision,heights,materials,exclusions}),bounds:Object.freeze({minX,minZ,maxX,maxZ})});patches.add(patch);return patch;
}

export function* normalSlices(lattice:Lattice):Generator<void,Float64Array,void>{
  const {cellsX,cellsZ,xs,zs,heights}=lattice,width=cellsX+1;
  const normals = new Float64Array(heights.length*3);
  const triangleNormal=(a:number,b:number,c:number)=>{
    const ax=xs[b%width]!-xs[a%width]!, ay=heights[b]!-heights[a]!, az=zs[Math.floor(b/width)]!-zs[Math.floor(a/width)]!;
    const bx=xs[c%width]!-xs[a%width]!, by=heights[c]!-heights[a]!, bz=zs[Math.floor(c/width)]!-zs[Math.floor(a/width)]!;
    for(const v of [a,b,c]) { normals[v*3]!+=ay*bz-az*by; normals[v*3+1]!+=az*bx-ax*bz; normals[v*3+2]!+=ax*by-ay*bx; }
  };
  for(let z=0;z<cellsZ;z++){for(let x=0;x<cellsX;x++){const a=z*width+x;triangleNormal(a,a+width,a+1);triangleNormal(a+1,a+width,a+width+1);}yield;}
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!);for(let k=0;k<3;k++)normals[i+k]!/=length;if(i%768===0)yield;}
  return normals;
}
function calculateNormals(lattice:Lattice):Float64Array {const slices=normalSlices(lattice);let next=slices.next();while(!next.done)next=slices.next();return next.value;}
export interface SurfaceWire extends Lattice { normals?:Float64Array }
/** Copy only after worker admission; never transfer the live canonical buffers. */
export function surfaceWire(surface:Surface,includeNormals=false):SurfaceWire {const data=lattices.get(surface);if(!data)throw Error('terrain: unknown surface');const {normals:_normals,...payload}=data;return structuredClone(includeNormals?data:payload);}
export interface PatchWire { data:SurfaceWire; bounds:SurfacePatch['bounds'] }
/** Row-sliced patch validation and normal reconstruction, shared by workers and fallback. */
export function* patchWireSlices(data:SurfaceWire,revision:number,edits:readonly SurfacePatchVertex[]):Generator<void,PatchWire,void>{
  integer(data.cellsX,'cellsX',256);integer(data.cellsZ,'cellsZ',256);if(!data.cellsX||!data.cellsZ)throw Error('terrain: empty wire');
  const count=(data.cellsX+1)*(data.cellsZ+1);
  if(data.heights.length!==count||data.materials.length!==count||data.exclusions.length!==count||data.xs.length!==data.cellsX+1||data.zs.length!==data.cellsZ+1)throw Error('terrain: malformed wire');
  integer(revision,'revision');if(revision<=data.revision||edits.length<1||edits.length>4096)throw Error('terrain: invalid patch');
  for(let i=0;i<count;i++){finite(data.heights[i]!,'height');if(i%256===0)yield;}
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;const seen=new Set<number>();
  for(const e of edits){integer(e.x,'patch x',data.cellsX);integer(e.z,'patch z',data.cellsZ);const i=e.z*(data.cellsX+1)+e.x;if(seen.has(i))throw Error('terrain: duplicate patch vertex');seen.add(i);
    if(e.height!==undefined){finite(e.height,'height');data.heights[i]=e.height;finite(data.heights[i]!,'height');}
    if(e.material!==undefined){integer(e.material,'material',65535);data.materials[i]=e.material;}
    if(e.excluded!==undefined){if(typeof e.excluded!=='boolean')throw Error('terrain: invalid exclusion');data.exclusions[i]=+e.excluded;}
    minX=Math.min(minX,e.x);minZ=Math.min(minZ,e.z);maxX=Math.max(maxX,e.x);maxZ=Math.max(maxZ,e.z);if(seen.size%256===0)yield;
  }
  data.revision=revision;data.normals=yield* normalSlices(data);return{data,bounds:{minX,minZ,maxX,maxZ}};
}
/** Adopt only the result of our pure patch job, against its still-live canonical ancestor. */
export function adoptPatchWire(previous:Surface,result:PatchWire):SurfacePatch {
  const {data,bounds}=result,old=lattices.get(previous);
  if(!old || data.id!==previous.id||!Number.isSafeInteger(data.revision)||data.revision<=previous.revision||data.cellsX!==old.cellsX||data.cellsZ!==old.cellsZ||data.spacing!==old.spacing||!(data.normals instanceof Float64Array)||data.normals.length!==old.heights.length*3||!(data.heights instanceof Float32Array)||data.heights.length!==old.heights.length||!(data.materials instanceof Uint16Array)||data.materials.length!==old.materials.length||!(data.exclusions instanceof Uint8Array)||data.exclusions.length!==old.exclusions.length)throw Error('terrain: mismatched worker patch');
  for(const [axis,expected] of [[data.xs,old.xs],[data.zs,old.zs]] as const)if(!(axis instanceof Float32Array)||axis.length!==expected.length||axis.some((v,i)=>v!==expected[i]))throw Error('terrain: worker topology changed');
  for(const [n,max] of [[bounds.minX,old.cellsX],[bounds.maxX,old.cellsX],[bounds.minZ,old.cellsZ],[bounds.maxZ,old.cellsZ]])integer(n,'worker patch bound',max);
  if(bounds.minX>bounds.maxX||bounds.minZ>bounds.maxZ)throw Error('terrain: invalid worker patch bounds');
  for(let i=0;i<data.heights.length;i++){
    finite(data.heights[i]!,'worker height');if(data.exclusions[i]!>1)throw Error('terrain: invalid worker exclusion');
    const x=i%(old.cellsX+1),z=Math.floor(i/(old.cellsX+1)),outside=x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ;
    if(outside&&(data.heights[i]!==old.heights[i]||data.materials[i]!==old.materials[i]||data.exclusions[i]!==old.exclusions[i]))throw Error('terrain: change outside worker patch bounds');
    const n=data.normals.subarray(i*3,i*3+3);if(!n.every(Number.isFinite)||n[1]!<=0||Math.abs(Math.hypot(...n)-1)>1e-5)throw Error('terrain: invalid worker normal');
    const outsideMargin=x<bounds.minX-1||x>bounds.maxX+1||z<bounds.minZ-1||z>bounds.maxZ+1;
    if(outsideMargin&&n.some((v,k)=>v!==old.normals![i*3+k]))throw Error('terrain: normal outside worker patch margin');
  }
  // Wire views may cover tiny ranges of oversized buffers, or carry unrelated payload.
  // Copy only admitted elements into intrinsic tightly sized arrays, without caller hooks.
  const owned:SurfaceWire={id:old.id,revision:data.revision,spacing:old.spacing,cellsX:old.cellsX,cellsZ:old.cellsZ,
    xs:new Float32Array(old.xs.length),zs:new Float32Array(old.zs.length),heights:new Float32Array(old.heights.length),materials:new Uint16Array(old.materials.length),exclusions:new Uint8Array(old.exclusions.length),normals:new Float64Array(old.heights.length*3)};
  for(const [target,source] of [[owned.xs,data.xs],[owned.zs,data.zs],[owned.heights,data.heights],[owned.materials,data.materials],[owned.exclusions,data.exclusions],[owned.normals!,data.normals]] as const)for(let i=0;i<target.length;i++)target[i]=source[i]!;
  const patch=Object.freeze({previous,surface:fromLattice(owned,owned.normals),bounds:Object.freeze({minX:bounds.minX,minZ:bounds.minZ,maxX:bounds.maxX,maxZ:bounds.maxZ})});patches.add(patch);return patch;
}

/** @internal Validate output from a trusted registered generator job, then copy into canonical ownership.
 * This bounded synchronous adoption pass validates identity/topology/data, not arbitrary generator semantics.
 */
export function adoptGeneratedSurface(expected: Pick<SampledSurfaceOptions, 'id' | 'revision' | 'originX' | 'originZ' | 'spacing' | 'cellsX' | 'cellsZ'>, data: SurfaceWire, exactAxes?: Readonly<{xs:Float32Array;zs:Float32Array}>): Surface {
  validateGrid(expected);
  const count = (expected.cellsX + 1) * (expected.cellsZ + 1);
  if (!data || data.id !== expected.id || data.revision !== expected.revision || data.spacing !== expected.spacing || data.cellsX !== expected.cellsX || data.cellsZ !== expected.cellsZ
    || !(data.heights instanceof Float32Array) || data.heights.length !== count || !(data.materials instanceof Uint16Array) || data.materials.length !== count
    || !(data.exclusions instanceof Uint8Array) || data.exclusions.length !== count || !(data.normals instanceof Float64Array) || data.normals.length !== count * 3) throw Error('terrain: invalid generated output');
  if(exactAxes&&(!(exactAxes.xs instanceof Float32Array)||!(exactAxes.zs instanceof Float32Array)||exactAxes.xs.length!==expected.cellsX+1||exactAxes.zs.length!==expected.cellsZ+1))throw Error('terrain: invalid exact axes');
  const xs = exactAxes?.xs.slice() ?? axis(expected.originX, expected.spacing, expected.cellsX), zs = exactAxes?.zs.slice() ?? axis(expected.originZ, expected.spacing, expected.cellsZ);
  for(const [values,cells,origin] of [[xs,expected.cellsX,expected.originX],[zs,expected.cellsZ,expected.originZ]] as const){
    if(values.length!==cells+1||values[0]!==Math.fround(origin))throw Error('terrain: invalid exact axes');
    for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i])||(i>0&&values[i]!<=values[i-1]!))throw Error('terrain: invalid exact axes');
  }
  for (const [received, actual] of [[data.xs, xs], [data.zs, zs]]) {
    if (!(received instanceof Float32Array) || received.length !== actual!.length) throw Error('terrain: generated topology mismatch');
    for (let i = 0; i < received.length; i++) if (received[i] !== actual![i]) throw Error('terrain: generated topology mismatch');
  }
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(data.heights[i]) || data.exclusions[i]! > 1) throw Error('terrain: invalid generated sample');
    const x = data.normals[i * 3]!, y = data.normals[i * 3 + 1]!, z = data.normals[i * 3 + 2]!;
    if (![x, y, z].every(Number.isFinite) || y <= 0 || Math.abs(Math.hypot(x, y, z) - 1) > 1e-5) throw Error('terrain: invalid generated normal');
  }
  const owned: SurfaceWire = { id: expected.id, revision: expected.revision, spacing: expected.spacing, cellsX: expected.cellsX, cellsZ: expected.cellsZ,
    xs, zs, heights: data.heights.slice(), materials: data.materials.slice(), exclusions: data.exclusions.slice(), normals: data.normals.slice() };
  return fromLattice(owned, owned.normals);
}

/** @internal Canonical one-cell crop: parent owns all halo samples and smooth normals. */
export function cropSurface(parent:Surface):Surface {
  const old=lattices.get(parent);if(!old||parents.has(parent)||old.cellsX<3||old.cellsZ<3)throw Error('terrain: invalid padded surface');
  const cellsX=old.cellsX-2,cellsZ=old.cellsZ-2,count=(cellsX+1)*(cellsZ+1);
  const heights=new Float32Array(count),materials=new Uint16Array(count),exclusions=new Uint8Array(count),normals=new Float64Array(count*3);
  for(let z=0;z<=cellsZ;z++)for(let x=0;x<=cellsX;x++){
    const i=z*(cellsX+1)+x,j=(z+1)*(old.cellsX+1)+x+1;
    heights[i]=old.heights[j]!;materials[i]=old.materials[j]!;exclusions[i]=old.exclusions[j]!;
    for(let k=0;k<3;k++)normals[i*3+k]=old.normals![j*3+k]!;
  }
  const surface=fromLattice({...old,cellsX,cellsZ,xs:old.xs.slice(1,-1),zs:old.zs.slice(1,-1),heights,materials,exclusions},normals);
  parents.set(surface,parent);return surface;
}
/** @internal Access backing for worker preparation; never transfer its live buffers. */
export function surfaceParent(surface:Surface):Surface|undefined{return parents.get(surface);}
/** @internal Optional patch fields must be bounded primitives before queue admission. */
export function validatePatchValues(height:unknown,material:unknown,excluded:unknown):void {
  if(height!==undefined&&(typeof height!=='number'||!Number.isFinite(height)||!Number.isFinite(Math.fround(height))))throw Error('terrain: invalid patch height');
  if(material!==undefined&&(typeof material!=='number'||!Number.isSafeInteger(material)||material<0||material>65535))throw Error('terrain: invalid patch material');
  if(excluded!==undefined&&typeof excluded!=='boolean')throw Error('terrain: invalid patch exclusion');
}
/** @internal Bounded capture before callbacks, queued work or copying buffers. */
export function captureCoreEdits(surface:Surface,edits:readonly SurfacePatchVertex[]):SurfacePatchVertex[]{
  if(!Array.isArray(edits))throw Error('terrain: invalid patch size');
  const count=edits.length;
  if(!Number.isSafeInteger(count)||count<1||count>4096)throw Error('terrain: invalid patch size');
  const result:SurfacePatchVertex[]=[];
  for(let i=0;i<count;i++){
    const {x,z,height,material,excluded}=edits[i]!;integer(x,'patch x',surface.cellsX);integer(z,'patch z',surface.cellsZ);
    validatePatchValues(height,material,excluded);
    result.push({x,z,height,material,excluded});
  }
  return result;
}
/** @internal Project a padded patch back onto its exact canonical child. */
export function projectSurfacePatch(previous:Surface,parentPatch:SurfacePatch):SurfacePatch {
  if(!patches.has(parentPatch)||parents.get(previous)!==parentPatch.previous)throw Error('terrain: invalid padded patch ancestry');
  const surface=cropSurface(parentPatch.surface),old=lattices.get(previous)!,next=lattices.get(surface)!;
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(let z=0;z<=surface.cellsZ;z++)for(let x=0;x<=surface.cellsX;x++){
    const i=z*(surface.cellsX+1)+x;
    if(old.heights[i]!==next.heights[i]||old.materials[i]!==next.materials[i]||old.exclusions[i]!==next.exclusions[i]||[0,1,2].some(k=>old.normals![i*3+k]!==next.normals![i*3+k])){
      minX=Math.min(minX,x);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxZ=Math.max(maxZ,z);
    }
  }
  const dirty=Number.isFinite(minX)?Object.freeze({minX,minZ,maxX,maxZ}):null;
  const b=parentPatch.bounds;
  const bounds=Object.freeze({minX:Math.max(0,Math.min(surface.cellsX,b.minX-1)),minZ:Math.max(0,Math.min(surface.cellsZ,b.minZ-1)),maxX:Math.max(0,Math.min(surface.cellsX,b.maxX-1)),maxZ:Math.max(0,Math.min(surface.cellsZ,b.maxZ-1))});
  const patch=Object.freeze({previous,surface,bounds,dirty});patches.add(patch);return patch;
}
/** Conservative retained typed-buffer bytes, including private halo and normals. */
export function surfaceBytes(surface:Surface):number {
  const data=lattices.get(surface);if(!data)throw Error('terrain: unknown canonical surface');
  const parent=parents.get(surface);
  return 4096+data.xs.byteLength+data.zs.byteLength+data.heights.byteLength+data.materials.byteLength+data.exclusions.byteLength+(data.normals?.byteLength??0)+(parent?surfaceBytes(parent):0);
}
