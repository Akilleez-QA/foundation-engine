const principals = new Set(['alpha', 'beta']);
const validId = (id) =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 32 &&
  /^[a-zA-Z0-9_-]+$/.test(id);
const exact = (frame, keys) =>
  frame !== null &&
  typeof frame === 'object' &&
  !Array.isArray(frame) &&
  Object.keys(frame).length === keys.length &&
  keys.every((key) => Object.hasOwn(frame, key));

/** Validate this reference protocol only; the caller applies a response after validation. */
export function decodeResponse(raw, { principal, pending }) {
  if (
    typeof raw !== 'string' ||
    raw.length > 1024 ||
    new TextEncoder().encode(raw).length > 1024
  )
    throw Error('response size');
  if (
    !(pending instanceof Map) ||
    (principal !== null && !principals.has(principal))
  )
    throw Error('response context');
  const frame = JSON.parse(raw);
  if (!frame || frame.v !== 1) throw Error('response version');
  if (frame.type === 'authenticated') {
    if (
      !exact(frame, ['v', 'type', 'principal']) ||
      !principals.has(frame.principal) ||
      principal !== null
    )
      throw Error('authentication response');
    return Object.freeze({
      v: 1,
      type: 'authenticated',
      principal: frame.principal,
    });
  }
  if (frame.type === 'result') {
    if (
      !exact(frame, ['v', 'type', 'id', 'target', 'value', 'applied']) ||
      !validId(frame.id) ||
      !pending.has(frame.id) ||
      !principals.has(frame.target) ||
      frame.target !== principal ||
      pending.get(frame.id) !== frame.target ||
      frame.applied !== true ||
      !Number.isSafeInteger(frame.value) ||
      frame.value < 0 ||
      frame.value > 100000
    )
      throw Error('result response');
    return Object.freeze({
      v: 1,
      type: 'result',
      id: frame.id,
      target: frame.target,
      value: frame.value,
      applied: true,
    });
  }
  if (frame.type === 'refused') {
    const identified = Object.hasOwn(frame, 'id');
    if (
      !exact(
        frame,
        identified ? ['v', 'type', 'reason', 'id'] : ['v', 'type', 'reason'],
      ) ||
      typeof frame.reason !== 'string' ||
      frame.reason.length > 128 ||
      (identified && (!validId(frame.id) || !pending.has(frame.id)))
    )
      throw Error('refusal response');
    return Object.freeze({
      v: 1,
      type: 'refused',
      reason: frame.reason,
      ...(identified ? { id: frame.id } : {}),
    });
  }
  throw Error('response type');
}
