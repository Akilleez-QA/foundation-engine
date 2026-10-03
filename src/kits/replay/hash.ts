import {captureJson, type JsonLimits} from '../network/captured-json';

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

/**
 * A 64-bit, two-lane multiplicative string hash over UTF-16 code units (16 lowercase hex characters).
 * It detects accidental change. It is not cryptographic and does not resist a deliberately forged collision.
 */
export function hashText(text: string): string {
  if (typeof text !== 'string') throw TypeError('replay hash: text must be a string');
  let a = 0xdeadbeef,
    b = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return hex(a) + hex(b);
}

/**
 * Canonical digest of JSON text: bounded parse, sorted keys and normalised numbers (the network kit's canonical v1),
 * then `hashText`. Two inputs that differ only in key order or whitespace have the same digest. Throws on limits.
 */
export function digestJson(json: string, limits: JsonLimits): string {
  return hashText(captureJson(json, limits).json);
}
