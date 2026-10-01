# Optional browser text transport

`createBrowserTransport` in `src/platform/network/browser-transport.ts` explicitly
owns one native WebSocket. It is an optional platform adapter, not a global module,
game protocol, identity service or replicated scene. Reference tools may construct
it directly. Ordinary player builds do not gain sockets, polling or dependencies
merely because this file exists. Creators may replace the transport while preserving
or deliberately changing the application-facing contract.

See the [network admission guide](network-admission.md) for the host/intake
composition, runnable example and separate acceptance boundaries.

## Inputs, ownership and capabilities

The caller supplies an absolute `ws:` or `wss:` URL and four positive safe-integer
limits: `maxMessageBytes`, `maxQueuedMessages`, `maxQueuedBytes` and
`maxBufferedBytes`. The adapter captures the limits. The endpoint is bounded to
4096 characters; fragments and URL credentials are rejected. Optional subprotocols
are at most eight distinct valid tokens of 1–128 characters. Endpoint and
subprotocol choices do not authenticate a principal or authorize any command.

An optional `socketFactory(url, protocols)` is a trusted construction/test seam.
Its structural `BrowserSocket` port uses only listener registration, state,
buffered amount, text send and close. The adapter exclusively owns the returned
socket. A custom factory must preserve native WebSocket semantics if it claims the
same capabilities; it is not a sandbox for malicious transport implementations.
There is no browser import of Node `ws`.

`capabilities` reports ordered, reliable text transport, with binary intake and
incoming application backpressure unsupported. Reliable transport does not mean
that a disconnected peer received or applied a particular message. The adapter
implements no acknowledgment, reconnect, retries, compression control or durability.

## Explicit admission and draining

```ts
import { createBrowserTransport } from '../../src/platform/network/browser-transport';

const transport = createBrowserTransport({
  url: 'wss://example.test/session',
  limits: {
    maxMessageBytes: 4096,
    maxQueuedMessages: 8,
    maxQueuedBytes: 16384,
    maxBufferedBytes: 16384,
  },
});

// From the consumer's existing bounded update/ticker:
for (const text of transport.drain(4)) {
  // Validate the creator's protocol and current session before domain dispatch.
  consumeAdmittedText(text);
}

const result = transport.send(JSON.stringify({ v: 1, type: 'example' }));
// result.status === 'sent' is local native-send admission, not remote acceptance.
// On scene/owner exit:
transport.dispose();
```

Native message events admit complete raw strings without JSON parsing or domain
callbacks. UTF-8 bytes include surrogate-pair and replacement-character encoding;
counting scans a bounded string without allocating another encoded byte buffer.
`drain(maxMessages)` accepts a safe integer from zero through `maxQueuedMessages`,
returns a frozen detached array in receive order and releases those queue charges.
The caller owns any retained drained data and its own parser/node/depth/work limits.
An empty string still occupies one message slot.

A binary/object frame, oversized text or exhausted queue closes the connection,
clears all retained inbound frames and records a fixed reason. It does not truncate
a frame, silently drop one update while reporting healthy state, or coalesce command
results. The consumer must mark its session unavailable and choose explicit recovery.
The adapter cannot decide which application messages would be safely replaceable.

`send(text)` refuses nonstrings, oversized strings, non-open sockets and recursive
send calls. It checks the native `bufferedAmount` plus the new UTF-8 payload against
`maxBufferedBytes` before calling native send. Backpressure refusal retains no retry
queue and leaves a healthy connection open; the caller decides whether to retry.
A native state/accounting/send failure retires the connection. Successful handoff is
`{status:'sent'}`; refusal is `{status:'refused',reason}`. If a custom socket retires
reentrantly during send, refusal does not promise that no bytes were already handed
off: exact application receipts are a separate requirement.

## Lifecycle and hidden consumers

`read()` reports `connecting`, `open`, `closed` or `disposed`; terminal reason;
queued count/bytes; captured limits; and admitted receive/send/refusal counters.
Counters saturate at `Number.MAX_SAFE_INTEGER`. Reads neither drain messages nor
query authority. Fixed failure reasons do not echo endpoint credentials, remote
close text or exception content.

Closing or disposal revokes event authority before removing listeners and invoking
native close. Late retained open/message/error/close callbacks cannot revive the
owner or refill its queue. Partial listener setup is cleaned up; cleanup exceptions
do not skip the other listener removals. Disposal is idempotent and releases queued
frames. A prior terminal cause remains visible after disposal. It creates no timer,
background retry or second animation/simulation loop.

A hidden or covered scene can stop producing commands and drain/pause under its
existing lifecycle policy. This adapter alone cannot pause native receive traffic:
if admission fills, it terminates and reports loss. Browser/network-stack buffers
and a large native event already allocated before admission are outside its heap
bound. A protocol may separately enforce bounded outstanding snapshot credit and
fresh baseline recovery on resume; neither credit nor replication is implemented
by this raw transport. Do not call a paused consumer safe simply because it stopped
its frame loop.

## Evidence and remaining boundaries

Focused injected-socket tests exercise text ordering, Unicode bytes, exact limits,
binary refusal, queue overload, buffered-send refusal, disposal/late callbacks,
partial listener-install failure, cleanup/send reentry and hidden undrained intake.
The implementation and these tests pass an isolated strict TypeScript check.

These tests establish adapter behavior under a controlled socket port. They do not
establish a real authenticated multi-peer workflow, network fault recovery, complete
replication, prediction, persistent authority, scalability or physical-device
performance. Native browser/server acceptance and the continuing networking ledger
must record those separately. Caller callbacks and custom factories are trusted
code; count/byte admission is not a preemptible CPU or whole-process memory sandbox.
