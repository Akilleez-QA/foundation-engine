# Proposal: validate durable interaction continuation through existing owners

Tracked in [issue #201](https://github.com/Akilleez-QA/foundation-engine/issues/201).

## Problem and smallest consumers

An accepted dialogue choice advances its state and returns effect intents. Saving
only the new dialogue state can lose pending work; retrying an effect without a
stable sink receipt can duplicate it. Conversation rewards and interaction unlocks
need explicit continuation across interruption and stale callback retirement.

Existing dialogue session/revision checks, inventory operation receipts, objective
event IDs and SaveStore section envelopes cover the ingredients. They do not make
arbitrary effects atomic across separate owners or storage keys.

## Proposed contract and placement

Keep the initial work as an unexported headless composition lab under tools. Save
dialogue, bounded intents and authoritative local sink state/receipts in one
versioned envelope. Separate accepted choice, delivery and acknowledgment. Use
fresh owner-local callback tickets after restoration and check save status before
continuing. Document precisely what remains creator-specific.

No new public quest language, dialogue graph, persistence owner or engine scheduler
is proposed. A shared helper should require independently useful consumers beyond
these deliberately small fixtures and a stable data contract.

## Ownership, limits, compatibility and validation

The interaction owner is retired on abort, disposal or player replacement; durable
accepted work remains recoverable by a fresh owner. Retained intents, choices and
sink history have explicit finite lab bounds. Capacity and validation refusal
publish no partial candidate. Write failure leaves session-only state and blocks
delivery until retry. Existing APIs and saved schemas are unchanged.

The implementation tests real dialogue, inventory, objectives and SaveStore using
fresh stores loaded from committed bytes. Cover interruption before delivery and
between delivery and acknowledgment, duplicate retry, stale callback, capacity,
malformed data/quarantine and injected failures at every write. Passing headless
tests do not certify runtime UI or browser persistence behavior.

## Alternatives and tradeoffs

Direct synchronous effects can suffice when no deferred work or independent
persistence boundary exists. Separate sections require application reconciliation
and cannot claim atomicity through SaveStore.batch. External sinks need their own
atomic mutation/receipt contract; otherwise an exactly-once promise is unsupported.
Bounded replay validation is simple for two authored interactions but should not
silently grow into an unrestricted script interpreter.

## Completion criteria

- Two real consumers resume to equivalent next receipts and authoritative state.
- Failure and stale-callback tests exercise genuine API boundaries.
- Document the coherent envelope, unsupported external effects and remaining evidence.
- Independent review before any public API graduation; full CI before integration.
