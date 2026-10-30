# Review follow-ups, 2026-09-30

This records disposition of the independent review against the moving private
engine repository. It is not public-release approval or physical-device acceptance.

| Finding | Disposition |
|---|---|
| Unrelated warm cleanup rejects a newly uploaded lease | Fixed by PR #10: publication no longer runs unrelated eviction. |
| No-op modal Confirm/Page keys swallow native/custom handling | Fixed: ports decline ineligible targets; unchanged-owner fallback reaches scoped handlers/native behavior while the gameplay barrier remains. |
| Reading panel requires focus navigation before paging | Initial focus is now the named reading region. Close remains next in the focus order; Back and return focus remain available. |
| Physical controllers do not feed the dispatcher | Application-owned polling now feeds registered actions through the existing frame loop; synthetic navigator evidence is distinct from physical hardware acceptance. |
| Missing `aria-modal` | Intentional: scope dialogs leave the shell interactive. Claiming page-wide modality would be inaccurate. |
| Hardware detection is bypassed by default authored Reference | Intentional under ADR 0070; clarified its opening wording. Explicit author quality is not silently lowered based on phone input or screen size. |
| Width-only decode hint treated as square | Fixed: incomplete dimensions use the conservative unknown-size reservation; complete dimensions retain their area bound. |
| Temporary decoder/worker overload rejects immediately | Bounded FIFO admission and limited abortable capacity retries. Sustained overload still fails explicitly; no fallback bypasses worker capacity. |
| Scene-model tests rely on one timer tick | Replaced by bounded readiness predicates and a controlled late result. This does not merge PR #3's release-preparation material. |
| Model instance cleanup failure strands sibling leases | Retirement attempts all cleanup operations, drains sibling slots and reports after cleanup; asynchronous error reporting cannot interrupt it. |

## Decoder limits

Defaults retain four active loads and 64 MiB of reserved decoded output. Up to 32
additional descriptors wait FIFO, without decoded allocation; admission times out
after five seconds. Saturation/preemption can retry 40 times at 25 ms intervals.
These are retry intervals/counts, not a total deadline for running worker jobs.
Oversized/invalid requests and exhausted limits fail explicitly. All waiting is
cancelable. Partial dimensions use the existing 16 MiB unknown-image allowance.
The decoder remains opt-in; this does not claim every texture path uses it.

## Evidence scope

Focused tests exercise lifecycle failures, native/custom input fallback and overload.
The real HUD browser composition checks phone, tablet and desktop emulation,
immediate paging, native unmarked scrolling, custom Enter handling, held controls,
controller dispatch, enlarged text and repeated ownership. Controller checks include injected edges and synthetic navigator snapshots through
the installed polling adapter; physical gamepads and native-device performance remain unverified.
The HUD browser script is manually invoked, not part of automated CI.

## Smaller review items

- Quality and UI-occlusion diagnostic reports now compute `dirtyWorktree` from Git
  status instead of always reporting true. Existing source hashes remain. Syntax
  checks passed; this metadata change does not expand browser/device acceptance.
- The expedition shelter reads its shared budget snapshot once per update and
  replaces diagnostic state only when its scalar values change. Dependency pumping
  remains on the existing frame owner, including optional work. Both existing
  shared-preparation tests pass; no performance measurement is claimed.
- The legacy `appNotify()` adapter discards its narration disposer, but source
  inspection found no production callers. Its singleton adds one listener to the
  process-wide event bus, not one per scene visit. `holdWhileNarrating()` itself
  returns working cleanup. A recurring scene leak is not established; introducing
  module ownership or removing the legacy adapter needs a separate compatibility
  decision. No notification lifetime behavior changed here.
