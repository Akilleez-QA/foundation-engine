/**
 * Script values: the only data that crosses between creator TypeScript and a script. Plain JSON-like data with
 * explicit bounds, so a call can never hand a script (or the host) an object graph, a function or an unbounded value.
 */

/** null, a boolean, a finite number, a string, an array or a plain string-keyed object of script values. */
export type ScriptValue =
  null | boolean | number | string | readonly ScriptValue[] | {readonly [key: string]: ScriptValue};

/** Bounds on one marshalled value (an argument list, a return value, a timer argument or a saved state). */
export interface ScriptValueLimits {
  /** Nesting depth of arrays/objects (the top level is depth 1). */
  readonly maxDepth: number;
  /** Values counted across the whole graph, containers included. */
  readonly maxNodes: number;
  /** UTF-16 code units in any one string or object key. */
  readonly maxStringLength: number;
}

export const SCRIPT_VALUE_LIMIT_RANGES: Readonly<Record<keyof ScriptValueLimits, readonly [number, number]>> =
  Object.freeze({maxDepth: [1, 64], maxNodes: [1, 1_000_000], maxStringLength: [1, 16 * 1024 * 1024]});

/** Thrown for a value outside the script value domain or its limits. */
export class ScriptValueError extends Error {
  override readonly name = 'ScriptValueError';
}

/** True for a plain object literal (prototype Object.prototype or null). */
const isPlainObject = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Deep-copy `value` into a frozen script value, refusing anything outside the domain or the limits. The copy means a
 * caller that mutates its object afterwards cannot change what a script saw or what was saved.
 */
export function captureScriptValue(value: unknown, limits: ScriptValueLimits, what = 'value'): ScriptValue {
  let nodes = 0;
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): ScriptValue => {
    if (++nodes > limits.maxNodes) throw new ScriptValueError(`${what}: more than ${limits.maxNodes} values`);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new ScriptValueError(`${what}: numbers must be finite`);
      return Object.is(v, -0) ? 0 : v;
    }
    if (typeof v === 'string') {
      if (v.length > limits.maxStringLength) throw new ScriptValueError(`${what}: a string is too long`);
      return v;
    }
    if (typeof v !== 'object') throw new ScriptValueError(`${what}: ${typeof v} is not a script value`);
    if (depth >= limits.maxDepth) throw new ScriptValueError(`${what}: nested deeper than ${limits.maxDepth}`);
    if (seen.has(v)) throw new ScriptValueError(`${what}: cycles are not script values`);
    seen.add(v);
    try {
      if (Array.isArray(v)) {
        const out: ScriptValue[] = [];
        for (let i = 0; i < v.length; i++) {
          if (!(i in v)) throw new ScriptValueError(`${what}: sparse arrays are not script values`);
          out.push(walk(v[i], depth + 1));
        }
        return Object.freeze(out);
      }
      if (!isPlainObject(v)) throw new ScriptValueError(`${what}: only plain objects and arrays are script values`);
      const out: Record<string, ScriptValue> = {};
      for (const key of Object.keys(v)) {
        if (key.length > limits.maxStringLength) throw new ScriptValueError(`${what}: a key is too long`);
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d || !('value' in d)) throw new ScriptValueError(`${what}: accessor properties are not script values`);
        const child = d.value as unknown;
        if (child === undefined) continue;
        defineKey(out, key, walk(child, depth + 1));
      }
      return Object.freeze(out);
    } finally {
      seen.delete(v);
    }
  };
  return walk(value, 0);
}

/** Set an own enumerable property, even for keys such as `__proto__` that plain assignment would treat specially. */
export function defineKey(target: Record<string, ScriptValue>, key: string, value: ScriptValue): void {
  Object.defineProperty(target, key, {value, enumerable: true, writable: true, configurable: true});
}

/** JSON text of a script value with object keys in code-unit order, so equal values always produce equal text. */
export function canonicalScriptJson(value: ScriptValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalScriptJson).join(',') + ']';
  const obj = value as {readonly [key: string]: ScriptValue};
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalScriptJson(obj[k] as ScriptValue)).join(',') + '}';
}

/**
 * Two independent 32-bit hashes over UTF-16 code units and the length, as 16 hex digits: identifies a script source
 * revision so a save is not restored onto different code by accident. Not cryptographic; it does not resist forgery.
 */
export function sourceDigest(text: string): string {
  let a = 0x811c9dc5,
    b = 0x9e3779b9 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul((b ^ c) + ((b << 6) | 0), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
