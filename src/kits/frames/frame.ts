import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
export interface FrameRef { readonly id: string; readonly generation: number }
export interface FrameNode extends FrameRef { readonly parent?: FrameRef; readonly matrix: readonly number[] }
export function frameRef(ref: FrameRef): FrameRef {
  if (!ref.id || !Number.isSafeInteger(ref.generation) || ref.generation < 0) throw Error('invalid frame identity');
  return Object.freeze({ id: ref.id, generation: ref.generation });
}
/** Immutable affine pose; finite and invertible so attachment can preserve world pose. */
export function poseMatrix(input: readonly number[]): readonly number[] {
  if (input.length !== 16 || !input.every(Number.isFinite) || input[3] !== 0 || input[7] !== 0 || input[11] !== 0 || input[15] !== 1 || Math.abs(new Matrix4().fromArray(input).determinant()) < 1e-12) throw Error('invalid affine pose');
  return Object.freeze([...input]);
}
export function createFrames(maxFrames = 128, maxDepth = 16) {
  if (![maxFrames, maxDepth].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('invalid frame budget');
  const nodes = new Map<string, FrameNode>(), generations = new Map<string, number>();
  return {
    set(node: FrameNode): boolean {
      const ref = frameRef(node), previous = nodes.get(ref.id);
      if ((previous && previous.generation > ref.generation) || (!previous && generations.has(ref.id) && ref.generation <= generations.get(ref.id)!)) return false;
      if (!generations.has(ref.id) && generations.size >= maxFrames) throw Error('frame capacity exceeded');
      const value = Object.freeze({ ...ref, ...(node.parent ? { parent: frameRef(node.parent) } : {}), matrix: poseMatrix(node.matrix) });
      let parent = value.parent; const visited = new Set([value.id]); let depth = 1;
      while (parent) {
        if (visited.has(parent.id)) throw Error('cyclic frame hierarchy'); visited.add(parent.id);
        if (++depth > maxDepth) throw Error('frame depth exceeded');
        const next = nodes.get(parent.id); if (!next || next.generation !== parent.generation) break; parent = next.parent;
      }
      nodes.set(value.id, value); generations.set(value.id, value.generation); return true;
    },
    remove(ref: FrameRef): boolean { const node = nodes.get(ref.id); return node?.generation === ref.generation ? nodes.delete(ref.id) : false; },
    resolve(ref: FrameRef): readonly number[] | null {
      frameRef(ref); const chain: FrameNode[] = [], seen = new Set<string>(); let current: FrameRef | undefined = ref;
      while (current) {
        if (seen.has(current.id) || chain.length >= maxDepth) return null; seen.add(current.id);
        const node = nodes.get(current.id); if (!node || node.generation !== current.generation) return null;
        chain.push(node); current = node.parent;
      }
      const pose = new Matrix4(); for (const node of chain.reverse()) pose.multiply(new Matrix4().fromArray(node.matrix));
      return poseMatrix(pose.elements);
    },
    get size() { return nodes.size; },
  };
}
export type Frames = ReturnType<typeof createFrames>;
/** Author Transform supports only uniform scale. Refuse shear/nonuniform data rather than silently losing it. */
export function authorPose(matrix: readonly number[]) {
  const source = new Matrix4().fromArray(poseMatrix(matrix)), p = new Vector3(), q = new Quaternion(), s = new Vector3(); source.decompose(p, q, s);
  if (Math.abs(s.x - s.y) > 1e-6 || Math.abs(s.x - s.z) > 1e-6) throw Error('author pose requires uniform scale');
  const rebuilt = new Matrix4().compose(p, q, s);
  // Both are 16-element matrices: i is in range.
  if (rebuilt.elements.some((v, i) => Math.abs(v - source.elements[i]!) > 1e-6)) throw Error('author pose cannot represent shear');
  const r = new Euler().setFromQuaternion(q, 'XYZ');
  return { x: p.x, y: p.y, z: p.z, rx: r.x, ry: r.y, rz: r.z, scale: s.x };
}
