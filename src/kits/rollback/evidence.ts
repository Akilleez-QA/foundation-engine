/**
 * Optional desync evidence store: collects the bounded, chunked evidence peers exchange after a checksum mismatch and
 * compares two peers' texts for one frame. Comparison of JSON texts uses the replay kit's first-difference
 * explanation; other texts report the first differing line.
 */
import {explainDivergence, type DivergenceExplanation} from '../replay/explain';
import {utf8BytesWithin} from './limits';
import type {RollbackEvidenceChunk} from './types';

export interface DesyncEvidenceStoreOptions {
  /** Total UTF-8 bytes held across every peer and frame, [64, 64 MiB]. */
  readonly maxBytes: number;
  /** Chunks per evidence text, [1, 65536]. */
  readonly maxChunks: number;
  /** Distinct (peer, frame) texts held, [1, 1024]. */
  readonly maxTexts: number;
}
export type DesyncEvidenceAdd =
  | Readonly<{status: 'stored' | 'complete' | 'duplicate'}>
  | Readonly<{status: 'refused'; reason: 'chunk' | 'conflict' | 'bytes' | 'texts'}>;
export type DesyncEvidenceComparison =
  | Readonly<{status: 'incomplete'; missing: readonly string[]}>
  | Readonly<{status: 'same-text'; frame: number}>
  | Readonly<{
      status: 'different';
      frame: number;
      line: number;
      a: string;
      b: string;
      json: DivergenceExplanation | null;
    }>;
export interface DesyncEvidenceStore {
  add(peer: string, chunk: RollbackEvidenceChunk): DesyncEvidenceAdd;
  /** The assembled text, or null until every chunk arrived. */
  text(peer: string, frame: number): Readonly<{text: string; checksum: number; truncated: boolean}> | null;
  compare(frame: number, a: string, b: string): DesyncEvidenceComparison;
  read(): Readonly<{bytes: number; texts: number; complete: number}>;
  clear(): void;
}

const whole = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;

export function createDesyncEvidenceStore(options: DesyncEvidenceStoreOptions): DesyncEvidenceStore {
  if (
    options === null ||
    typeof options !== 'object' ||
    !whole(options.maxBytes, 64, 64 << 20) ||
    !whole(options.maxChunks, 1, 65536) ||
    !whole(options.maxTexts, 1, 1024)
  )
    throw Error('desync evidence: invalid limits');
  type Entry = {checksum: number; count: number; truncated: boolean; parts: (string | undefined)[]; have: number};
  const texts = new Map<string, Entry>();
  let bytes = 0;
  const key = (peer: string, frame: number) => `${frame}\u0000${peer}`;
  const assembled = (e: Entry) => (e.have === e.count ? e.parts.join('') : null);
  return Object.freeze({
    add(peer: string, chunk: RollbackEvidenceChunk): DesyncEvidenceAdd {
      if (
        typeof peer !== 'string' ||
        chunk === null ||
        typeof chunk !== 'object' ||
        !whole(chunk.frame, 0, 2 ** 53 - 1) ||
        !whole(chunk.checksum, 0, 0xffffffff) ||
        !whole(chunk.count, 1, options.maxChunks) ||
        !whole(chunk.index, 0, chunk.count - 1) ||
        typeof chunk.truncated !== 'boolean' ||
        typeof chunk.text !== 'string'
      )
        return Object.freeze({status: 'refused' as const, reason: 'chunk' as const});
      const k = key(peer, chunk.frame);
      let e = texts.get(k);
      if (e && (e.count !== chunk.count || e.checksum !== chunk.checksum || e.truncated !== chunk.truncated))
        return Object.freeze({status: 'refused' as const, reason: 'conflict' as const});
      if (e?.parts[chunk.index] !== undefined)
        return e.parts[chunk.index] === chunk.text
          ? Object.freeze({status: 'duplicate' as const})
          : Object.freeze({status: 'refused' as const, reason: 'conflict' as const});
      const size = utf8BytesWithin(chunk.text, options.maxBytes - bytes);
      if (size === Infinity) return Object.freeze({status: 'refused' as const, reason: 'bytes' as const});
      if (!e) {
        if (texts.size >= options.maxTexts)
          return Object.freeze({status: 'refused' as const, reason: 'texts' as const});
        e = {checksum: chunk.checksum, count: chunk.count, truncated: chunk.truncated, parts: [], have: 0};
        texts.set(k, e);
      }
      e.parts[chunk.index] = chunk.text;
      e.have++;
      bytes += size;
      return Object.freeze({status: e.have === e.count ? ('complete' as const) : ('stored' as const)});
    },
    text(peer: string, frame: number) {
      const e = texts.get(key(peer, frame));
      const t = e ? assembled(e) : null;
      return e && t !== null ? Object.freeze({text: t, checksum: e.checksum, truncated: e.truncated}) : null;
    },
    compare(frame: number, a: string, b: string): DesyncEvidenceComparison {
      const x = this.text(a, frame),
        y = this.text(b, frame);
      const missing = [...(x ? [] : [a]), ...(y ? [] : [b])];
      if (!x || !y) return Object.freeze({status: 'incomplete' as const, missing: Object.freeze(missing)});
      if (x.text === y.text) return Object.freeze({status: 'same-text' as const, frame});
      const la = x.text.split('\n'),
        lb = y.text.split('\n');
      let line = 0;
      while (line < la.length && line < lb.length && la[line] === lb[line]) line++;
      const looksJson = (t: string) => /^\s*[[{]/.test(t);
      const json = looksJson(x.text) && looksJson(y.text) ? explainDivergence(frame, x.text, y.text) : null;
      const cap = (s: string | undefined) => (s === undefined ? '' : s.length > 160 ? `${s.slice(0, 159)}…` : s);
      return Object.freeze({
        status: 'different' as const,
        frame,
        line: line + 1,
        a: cap(la[line]),
        b: cap(lb[line]),
        json,
      });
    },
    read() {
      let complete = 0;
      for (const e of texts.values()) if (e.have === e.count) complete++;
      return Object.freeze({bytes, texts: texts.size, complete});
    },
    clear() {
      texts.clear();
      bytes = 0;
    },
  });
}
