/** Explicit native socket ownership. No parser, authority, retry timer or frame loop. */
export interface BrowserSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  send(text: string): void;
  close(code?: number, reason?: string): void;
}
export interface BrowserTransportLimits {
  maxMessageBytes: number;
  maxQueuedMessages: number;
  maxQueuedBytes: number;
  maxBufferedBytes: number;
}
export interface BrowserTransportOptions {
  url: string;
  protocols?: readonly string[];
  limits: BrowserTransportLimits;
  /** Trusted construction seam; the returned socket is exclusively owned by this adapter. */
  socketFactory?: (url: string, protocols: readonly string[]) => BrowserSocket;
}
export type BrowserTransportReason = 'disposed' | 'remote-close' | 'socket-error' | 'socket-state'
  | 'unavailable' | 'construction-error' | 'message-type' | 'message-too-large' | 'queue-overflow' | 'send-error';
export type BrowserSendResult = Readonly<{ status: 'sent' } | {
  status: 'refused'; reason: 'not-open' | 'busy' | 'message-type' | 'message-too-large' | 'backpressure' | 'send-error';
}>;
const capabilities = Object.freeze({ ordered: true, reliable: true, text: true, binary: false, incomingBackpressure: false });
const positive = (n: number): number => {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw Error('network: positive safe integer required');
  return n;
};
/** Native data is already allocated; scan at most the configured number of code units, without another byte buffer. */
function bytes(text: string, limit: number): number {
  if (text.length > limit) return Infinity;
  let size = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) size++;
    else if (unit < 0x800) size += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
    else size += 3;
    if (size > limit) return Infinity;
  }
  return size;
}
const saturate = (a: number, b = 1) => Math.min(Number.MAX_SAFE_INTEGER, a + b);

export function createBrowserTransport(options: BrowserTransportOptions) {
  const url = options.url;
  if (typeof url !== 'string' || url.length > 4096) throw Error('network: invalid endpoint');
  const endpoint = new URL(url);
  if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.hash || endpoint.username || endpoint.password)
    throw Error('network: invalid endpoint');
  const source = options.limits;
  const limits = Object.freeze({
    maxMessageBytes: positive(source.maxMessageBytes), maxQueuedMessages: positive(source.maxQueuedMessages),
    maxQueuedBytes: positive(source.maxQueuedBytes), maxBufferedBytes: positive(source.maxBufferedBytes),
  });
  const requested = options.protocols ?? [];
  if (!Array.isArray(requested)) throw Error('network: invalid protocols');
  const length = requested.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > 8) throw Error('network: protocol count');
  const protocols: string[] = [];
  for (let i = 0; i < length; i++) {
    const protocol = requested[i];
    if (typeof protocol !== 'string' || protocol.length < 1 || protocol.length > 128
      || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(protocol) || protocols.includes(protocol)) throw Error('network: invalid protocol');
    protocols.push(protocol);
  }
  Object.freeze(protocols);
  let state: 'connecting' | 'open' | 'closed' | 'disposed' = 'connecting';
  let reason: BrowserTransportReason | null = null;
  let socket: BrowserSocket | null = null, sending = false;
  let queue: { text: string; bytes: number }[] = [], queuedBytes = 0;
  let receivedMessages = 0, receivedBytes = 0, sentMessages = 0, sentBytes = 0, refusedSends = 0;
  const registered: [string, EventListener][] = [];
  const live = () => state === 'connecting' || state === 'open';
  function finish(why: BrowserTransportReason, closeSocket = true) {
    if (!live()) return;
    state = why === 'disposed' ? 'disposed' : 'closed'; reason = why;
    queue = []; queuedBytes = 0;
    const owned = socket;
    // Revoke authority before invoking injected/native cleanup that may reenter.
    for (const [type, listener] of registered.splice(0)) {
      try { owned?.removeEventListener(type, listener); } catch { /* Continue releasing every listener. */ }
    }
    if (closeSocket) {
      try { owned?.close(1000, 'transport retired'); } catch { /* Terminal even if native cleanup fails. */ }
    }
    socket = null;
  }
  const open: EventListener = () => {
    if (state !== 'connecting') return;
    try { if (socket?.readyState === 1 && live()) state = 'open'; else finish('socket-state'); }
    catch { finish('socket-error'); }
  };
  const message: EventListener = event => {
    if (state !== 'open') return;
    let data: unknown;
    try { data = (event as MessageEvent<unknown>).data; } catch { finish('message-type'); return; }
    if (state !== 'open') return;
    if (typeof data !== 'string') { finish('message-type'); return; }
    const size = bytes(data, limits.maxMessageBytes);
    if (!Number.isFinite(size)) { finish('message-too-large'); return; }
    if (queue.length >= limits.maxQueuedMessages || size > limits.maxQueuedBytes - queuedBytes) { finish('queue-overflow'); return; }
    queue.push({ text: data, bytes: size }); queuedBytes += size;
    receivedMessages = saturate(receivedMessages); receivedBytes = saturate(receivedBytes, size);
  };
  const closed: EventListener = () => finish('remote-close', false);
  const error: EventListener = () => finish('socket-error');
  try {
    const factory = options.socketFactory;
    if (!factory && typeof WebSocket === 'undefined') finish('unavailable');
    else {
      socket = factory ? factory(endpoint.href, protocols) : new WebSocket(endpoint.href, protocols);
      const initial = socket.readyState;
      if (initial === 1) state = 'open';
      else if (initial !== 0) finish('socket-state');
      for (const row of [['open', open], ['message', message], ['close', closed], ['error', error]] as [string, EventListener][]) {
        if (!live()) break;
        registered.push(row);
        socket!.addEventListener(...row);
      }
    }
  } catch { finish('construction-error'); }
  const refuse = (why: Extract<BrowserSendResult, { status: 'refused' }>['reason']): BrowserSendResult => {
    refusedSends = saturate(refusedSends); return Object.freeze({ status: 'refused', reason: why });
  };
  return Object.freeze({
    capabilities,
    send(text: string): BrowserSendResult {
      if (sending) return refuse('busy');
      if (state !== 'open' || !socket) return refuse('not-open');
      if (typeof text !== 'string') return refuse('message-type');
      const size = bytes(text, limits.maxMessageBytes);
      if (!Number.isFinite(size)) return refuse('message-too-large');
      sending = true;
      try {
        const owned = socket, buffered = owned.bufferedAmount, ready = owned.readyState;
        if (state !== 'open' || socket !== owned) return refuse('not-open');
        if (ready !== 1) { finish('socket-state'); return refuse('not-open'); }
        if (!Number.isSafeInteger(buffered) || buffered < 0) { finish('socket-error'); return refuse('send-error'); }
        if (size > limits.maxBufferedBytes - buffered) return refuse('backpressure');
        owned.send(text);
        if (state !== 'open' || socket !== owned) return refuse('not-open');
        sentMessages = saturate(sentMessages); sentBytes = saturate(sentBytes, size);
        return Object.freeze({ status: 'sent' });
      } catch { finish('send-error'); return refuse('send-error'); }
      finally { sending = false; }
    },
    drain(maxMessages: number): readonly string[] {
      if (typeof maxMessages !== 'number' || !Number.isSafeInteger(maxMessages) || maxMessages < 0
        || maxMessages > limits.maxQueuedMessages) throw Error('network: drain budget');
      const rows = queue.splice(0, maxMessages);
      for (const row of rows) queuedBytes -= row.bytes;
      return Object.freeze(rows.map(row => row.text));
    },
    read() {
      return Object.freeze({ state, reason, queuedMessages: queue.length, queuedBytes,
        receivedMessages, receivedBytes, sentMessages, sentBytes, refusedSends, limits, capabilities });
    },
    dispose() {
      if (live()) finish('disposed');
      else if (state !== 'disposed') { state = 'disposed'; /* Preserve the terminal cause. */ }
    },
  });
}
