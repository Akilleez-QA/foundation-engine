# ADR 0088: optional acknowledged-baseline view deltas

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Network
- **Tracking:** discussion issue linked from the pull request

## Context

The network kit's scoped views are complete frames: every publish reprojects and
resends every disclosed entity, and the network-views guide lists delta
replication as not provided. With one outstanding credit per connection the host
knows exactly which frame the client last adopted, which is the precondition for
a safe delta. Rewriting the publisher or receiver would put their carefully
tested ordering, duplicate, conflict and retirement rules at risk.

## Decision

Add an optional encoder/decoder pair that wraps the existing owners instead of
replacing them. The encoder sits on the publisher's `send` port and keeps the
pending frame and the last frame acknowledged as adopted; the decoder sits before
`receiver.receive` and keeps the frame the consumer adopted. Deltas are
entity-level (upserts, removals and an order only when needed). The encoder
proves every delta with the decoder's own capture and rebuild and sends it only
when the rebuilt JSON equals the publisher's exact bytes and is shorter; otherwise
it sends the complete frame. Acknowledgments carry `adopted`, so a failed
adoption clears the baseline and forces a complete frame.

## Consequences

The receiver sees only complete frames, so its rules apply unchanged; rebuilt
frames are byte-identical, so duplicate detection still works. Memory is two
retained frames per side under existing `ViewLimits`. Encoding costs one
serialization per entity plus a capture and rebuild per delta. The
acknowledgment message shape (`sequence`, `adopted`) is creator protocol.
Field-level deltas, quantization, binary codecs, byte-budget prioritisation and
interpolation are not provided. Evidence is headless tests with the real
publisher and receiver plus one local measurement; WAN and device acceptance are
not claimed.
