/**
 * kits/physics/pose: Transform Euler angles (radians, XYZ order, as the renderer applies `rotation.set(rx, ry, rz)`)
 * to and from the library's unit quaternions, and the snapshot text encodings. Pure.
 *
 * `math` chooses the trigonometry: `platformMath` (the browser's Math) or `dmath` (bit-identical in every JavaScript
 * engine). Only conversions run here; the library's own arithmetic is its deterministic build's concern.
 */
import type {ScalarMath} from '../../author';

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface Euler {
  rx: number;
  ry: number;
  rz: number;
}

/** Euler XYZ to a unit quaternion. */
export function eulerToQuat(rx: number, ry: number, rz: number, m: ScalarMath): Quat {
  const c1 = m.cos(rx / 2),
    c2 = m.cos(ry / 2),
    c3 = m.cos(rz / 2),
    s1 = m.sin(rx / 2),
    s2 = m.sin(ry / 2),
    s3 = m.sin(rz / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

/** A unit quaternion to Euler XYZ (the same decomposition as three.js `Euler.setFromQuaternion(q, 'XYZ')`). */
export function quatToEuler(q: Quat, m: ScalarMath): Euler {
  const {x, y, z, w} = q;
  const m11 = 1 - 2 * (y * y + z * z),
    m12 = 2 * (x * y - w * z),
    m13 = 2 * (x * z + w * y),
    m22 = 1 - 2 * (x * x + z * z),
    m23 = 2 * (y * z - w * x),
    m32 = 2 * (y * z + w * x),
    m33 = 1 - 2 * (x * x + y * y);
  const s = Math.min(1, Math.max(-1, m13));
  const ry = m.atan2(s, m.sqrt(Math.max(0, 1 - s * s)));
  return Math.abs(s) < 0.9999999
    ? {rx: m.atan2(-m23, m33), ry, rz: m.atan2(-m12, m11)}
    : {rx: m.atan2(m32, m22), ry, rz: 0};
}

/** A library handle (a float64 whose bits pack index and generation) as 16 hex digits: exact, JSON-safe. */
export function handleToHex(handle: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, handle);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}
const HEX16 = /^[0-9a-f]{16}$/;
/** The inverse of handleToHex; null for anything else. */
export function hexToHandle(text: unknown): number | null {
  if (typeof text !== 'string' || !HEX16.test(text)) return null;
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${text}`));
  return view.getFloat64(0);
}

const CHUNK = 0x8000;
/** Bytes to base64 (chunked, so large snapshots do not overflow the argument limit). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + CHUNK)));
  return btoa(binary);
}
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** Base64 to bytes; null when the text is not canonical base64. */
export function base64ToBytes(text: unknown): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
