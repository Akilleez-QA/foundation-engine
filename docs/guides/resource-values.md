# Explicit current resource values

This optional pure helper validates one current quantity and prepares arithmetic
candidates. Creators choose the meaning and units, capacity, numeric mode,
rounding, range-change policy and when a change is accepted. It owns no actor,
clock, regeneration, lifetime, revision, receipt, storage or global registry.
Creators can omit or replace it.

```ts
import { parseResourceValue, prepareResourceChange } from '@kits/capabilities';

const accepted = parseResourceValue({
  version: 1, mode: 'safe-integer', min: 0, max: 20, current: 12,
});
const candidate = prepareResourceChange(accepted,
  { kind: 'add', delta: -3 },
  { overflow: 'reject', rounding: 'reject' },
);
if (candidate.ok) {
  // Validate the enclosing document ticket and all coupled consequences here.
  // Only creator code publishes candidate.state into accepted state.
}
```

## Input and restore contracts

`ResourceValue` contains exactly `version`, `mode`, `min`, `max`, `current`.
Version is `1`. Modes are `continuous` and `safe-integer`; all three numbers must
be finite, min≤max and min≤current≤max. Safe-integer mode requires all three to be
safe integers. Negative ranges and collapsed intervals are permitted. Zero is
canonicalized so negative zero does not survive in accepted values.

`parseResourceValue(raw)` captures a detached frozen record or throws. It does
not clamp, round, reset, migrate or convert precision mode during restoration.
Mode conversion is outside this helper; the creator supplies an explicit validated
migration if their saved contract changes. Extra keys, including symbols, reject.

`prepareResourceChange(raw, change, policy)` strictly parses the snapshot, captures
the requested change and policy, and returns a frozen success or refusal. Each
field is captured once; discriminator getters cannot select a second branch on a
later read. A throwing accessor/proxy produces an `invalid` candidate. As with
other JavaScript helpers, executing caller getters is not a sandbox: their external
side effects are not undone. Supply ordinary data records at integration boundaries.

## Operations and policies

| Change | Calculated request |
| --- | --- |
| `{kind:'set', value}` | Supplied value. |
| `{kind:'add', delta}` | Current plus the supplied delta. |
| `{kind:'bounds', min, max, adjust:'retain'}` | Retain the old current value under the new interval. |
| `{kind:'bounds', min, max, adjust:'ratio'}` | Preserve position within the old interval: newMin + (current−oldMin)/(oldMax−oldMin) × (newMax−newMin). |
| `{kind:'bounds', min, max, adjust:'refill'}` | Request the new maximum explicitly. |

Both policy fields are required:

- `overflow:'reject'|'clamp'` handles a representable rounded target outside the
  authored interval. Clamp is a domain decision; it never repairs Infinity,
  NaN or unsafe accepted integer arithmetic.
- `rounding:'reject'|'floor'|'ceil'|'nearest'` chooses integer quantization.
  Nearest ties go toward positive infinity: −1.5 becomes −1, +1.5 becomes +2.
  Continuous mode requires `rounding:'reject'` and retains fractional values;
  it does not silently apply or ignore a quantization option.

For integer addition, the **delta is rounded before checked addition**. This
prevents a large current value from swallowing a small fractional request before
`reject` or `ceil` can act. For example, adding 0.1 at the largest safe integer
refuses with `precision` under reject, remains unchanged under floor, and refuses
with `overflow` under ceil—even if domain clamp was selected.

Integer ratio adjustment uses exact bounded BigInt numerator/denominator arithmetic
internally, including rounding ties and negative numerators. Inputs are safe
integers, so intermediate magnitudes stay below 2^109. No BigInt appears in the
public result or saved snapshot. An old zero-width ratio refuses with `zero-width`;
it does not invent a fullness fraction. A newly collapsed valid interval is allowed.

Continuous calculations use JavaScript Number arithmetic. Every required
arithmetic intermediate and returned actual delta must remain finite. Rounding
and underflow inherent to binary64 can produce a successful no-op; this is not
an exact decimal or arbitrary-precision API. Intermediates unused by an operation
are not evaluated: a very wide valid interval can still accept set/retain even
when its width would overflow a ratio calculation.

## Candidate and diagnostic outputs

Success is `{ok:true,state,calculation}`. It does not publish state. All nested
records are frozen and detached. `calculation` distinguishes:

- `requested`: original captured operation/argument, including an additive delta.
- `policy`: captured overflow and rounding selections.
- `calculatedTarget`: diagnostic Number approximation before quantization.
- `targetPrecision`: `approximate-number` or `approximate-ratio`; neither field
  substitutes for the checked accepted value. A diagnostic target can round away
  fractional intent or itself resemble an unsafe integer near Number limits.
- `roundedTarget`: checked target before domain reject/clamp.
- `roundedAddend`: the checked integer delta for integer add, otherwise null.
- `acceptedTarget`: final candidate current value.
- `actualDelta`: acceptedTarget minus the previous accepted current.
- `clamped`: whether domain clamping changed the rounded target.

In safe-integer mode, rounded targets, rounded addends, accepted values and actual
deltas must all be safe integers. An interval may have safe endpoints whose span
is not a safe integer. That snapshot is permitted; a particular transition whose
required actual delta is unsafe refuses rather than returning a misleading number.
The original request and diagnostic approximation remain distinct from those
checked arithmetic outputs.

Refusal is `{ok:false,reason}` with one of:

| Reason | Meaning |
| --- | --- |
| `invalid` | Wrong shape/type/mode/policy, nonfinite input or input-access failure. |
| `range` | Reversed bounds, invalid restored current, or domain reject. |
| `precision` | Fractional integer state/bounds or requested quantization refusal. |
| `overflow` | Unsafe required integer result/delta or nonfinite arithmetic. |
| `zero-width` | Ratio requested from a collapsed old interval. |

Rejected candidates leave their input unchanged. Repeating a successful add is
not inherently idempotent; the caller uses existing document tickets, receipts or
other accepted-state mechanisms. No read adjusts current quantity or refills it.

## Composition and verification scope

When modifiers change capacity, prepare the selected resource transition together
with that modifier/progression change in the enclosing candidate. Validate every
coupled consequence before publishing the document. Reads only project accepted
facts. SaveStore durability remains separate from in-memory acceptance; retrying
an exact envelope must not reapply the resource operation.

Focused tests cover strict restore, detached captures, negative ranges, fractional
and integer modes, all rounding policies, old/new collapsed intervals, wide spans,
exact ratio ties, unsafe deltas, arithmetic overflow before clamp, honest no-ops,
getter failure and reentrant pure preparation. The helper has fixed-size output
and no loops depending on quantity magnitude; record-shape validation still
examines supplied keys. These tests do not establish the future consumer's UI,
persistence, device performance or arbitrary creator callback behavior.
