import { createAuthoredDocument, type DocumentValue } from '../authoring/document';

export type JsonLimits = Readonly<{ maxBytes: number; maxNodes: number; maxDepth: number }>;
export function captureJsonLimits(input: JsonLimits): JsonLimits {
  const limits = { maxBytes: input.maxBytes, maxNodes: input.maxNodes, maxDepth: input.maxDepth };
  if (!Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0)) throw Error('network JSON: invalid limits');
  return Object.freeze(limits);
}

/** Canonical v1: sorted UTF-16 keys, ordered arrays, JSON numbers/strings, no Unicode normalization. */
export function captureJson(json: string, input: JsonLimits, validate: (value: DocumentValue) => boolean = () => true) {
  const limits = captureJsonLimits(input);
  const document = createAuthoredDocument({ id: 'network-json', json, limits,
    validate: (value): value is DocumentValue => true });
  const value = document.read().value;
  document.dispose();
  // Iterative serialization avoids making accepted nesting depend on the JS call stack.
  type Task = { value: DocumentValue } | { text: string };
  const pending: Task[] = [{ value }], parts: string[] = [];
  let length = 0;
  while (pending.length) {
    const task = pending.pop()!;
    if ('text' in task) {
      length += task.text.length;
      if (length > limits.maxBytes) throw Error('network JSON: canonical byte limit');
      parts.push(task.text);
      continue;
    }
    const entry = task.value;
    if (entry === null || typeof entry !== 'object') {
      pending.push({ text: JSON.stringify(entry) });
    } else if (Array.isArray(entry)) {
      pending.push({ text: ']' });
      for (let i = entry.length - 1; i >= 0; i--) {
        pending.push({ value: entry[i] });
        if (i > 0) pending.push({ text: ',' });
      }
      pending.push({ text: '[' });
    } else {
      pending.push({ text: '}' });
      const record = entry as { readonly [key: string]: DocumentValue };
      const keys = Object.keys(record).sort();
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i]!; // 0 <= i < keys.length, an own key of record
        pending.push({ value: record[key]! }, { text: ':' }, { text: JSON.stringify(key) });
        if (i > 0) pending.push({ text: ',' });
      }
      pending.push({ text: '{' });
    }
  }
  const canonical = parts.join(''), bytes = new TextEncoder().encode(canonical).length;
  if (bytes > limits.maxBytes) throw Error('network JSON: canonical byte limit');
  // The reducer and validator must see exactly the canonical wire value, including -0 -> 0.
  const normalized = createAuthoredDocument({ id: 'network-json', json: canonical, limits,
    validate: (candidate): candidate is DocumentValue => validate(candidate) === true });
  const captured = normalized.read().value;
  normalized.dispose();
  return Object.freeze({ value: captured, json: canonical, bytes });
}
