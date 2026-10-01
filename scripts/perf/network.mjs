// scripts/perf/network.mjs: the bench's network ledger (ADR 0046, ADR 0053). Hermetic by default: every request that
// leaves the served origin is blocked and counted by origin, so a run never depends on the internet. The ledger
// counts requests, bytes and what is in flight, from the page's CDP Network events, so the bench can wait until
// loading is quiet before a window and record the bytes a scene cost to enter.
// Worker requests are counted when Chromium reports them on the page session; workers' own sessions are not attached.
const STREAMS = new Set(['Media', 'WebSocket', 'EventSource', 'Ping']);

/** Pure accounting over CDP Network events. */
export class RequestLedger {
  requests = 0; bytes = 0; failures = 0; revision = 0;
  pending = new Map();
  request(p) {
    if (/^(data|blob):/.test(p.request.url) || STREAMS.has(p.type)) return;
    if (!this.pending.has(p.requestId)) this.requests++;
    this.pending.set(p.requestId, p.request.url); this.revision++;
  }
  finish(p, failed = false) {
    if (failed) this.failures++; else this.bytes += p.encodedDataLength ?? 0;
    if (this.pending.delete(p.requestId)) this.revision++;
  }
  snapshot() { return {requests: this.requests, bytes: this.bytes, failures: this.failures, pending: this.pending.size, revision: this.revision, urls: [...this.pending.values()]}; }
}

/** Is `url` served by the bench's own origin (or inline data)? */
export const isLocal = (url, origin) => { if (/^(data|blob):/.test(url)) return true; try { return new URL(url).origin === origin; } catch { return false; } };

/** Install before navigation: blocks (hermetic) or lets through (live) foreign requests, and feeds the ledger. */
export async function observeNetwork(b, {base, liveNetwork = false}) {
  const origin = new URL(base).origin, ledger = new RequestLedger(), external = new Map();
  const note = url => { try { const k = new URL(url).origin; external.set(k, (external.get(k) ?? 0) + 1); } catch { /* not a URL */ } };
  await b.page.route('**/*', route => {
    const url = route.request().url();
    if (isLocal(url, origin)) return route.continue();
    note(url);
    return liveNetwork ? route.continue() : route.abort('blockedbyclient');
  });
  b.cdp.on('Network.requestWillBeSent', p => ledger.request(p));
  b.cdp.on('Network.loadingFinished', p => ledger.finish(p));
  b.cdp.on('Network.loadingFailed', p => ledger.finish(p, true));
  await b.send('Network.enable');
  return {ledger, external, snapshot: () => ledger.snapshot()};
}
