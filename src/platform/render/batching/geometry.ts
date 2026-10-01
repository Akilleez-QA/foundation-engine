import type {BufferGeometry} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Consume compatible, already transformed buffers supplied by a static paint builder.
 * No attribute stripping, de-indexing, material changes or semantic-group traversal.
 * Inputs must be exclusively owned temporary buffers; a failed merge leaves them intact.
 */
export function bakeGeometry(parts:BufferGeometry[]):BufferGeometry{
 const geometry=mergeGeometries(parts);
 if(!geometry)throw new Error('Static paint bake requires compatible geometry attributes');
 for(const part of new Set(parts))part.dispose();
 return geometry;
}

/** Consumes owned temporary buffers even when incompatible attributes prevent a merge.
 * Material-bucket callers retain their existing null fallback; borrowed source geometry
 * must be cloned or normalized into separate buffers before this call.
 */
export function tryBakeGeometry(parts:BufferGeometry[]):BufferGeometry|null{
 const geometry=mergeGeometries(parts);
 for(const part of new Set(parts))part.dispose();
 return geometry;
}
