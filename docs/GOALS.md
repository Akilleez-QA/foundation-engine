# Foundation Engine goals

This is a concise statement of the goals already established by the architecture
standard and engine boundary. It does not turn research proposals into commitments
or claim that every goal has been fully demonstrated. [STANDARD.md](STANDARD.md)
remains the normative engineering contract.

The active [creator-readiness milestone](guides/creator-readiness-goal.md) turns these goals into a finite acceptance scorecard and contributor work sequence.

## Purpose

Provide a reusable, genre-neutral browser game engine that enables independent
authors to build and maintain different games without repeatedly implementing
runtime infrastructure. Deliver a defined quality floor at measured performance,
with explicit extension points, bounded resource use and dependable tooling.

The current implementation platform is TypeScript, Three.js and WebGL2 by default;
WebGPU is an optional, creator-selected render backend (ADR 0078). Native runtimes,
a general visual editor and distributed services are separate potential projects,
not implied deliverables of this definition.

## Creator freedom

The engine offers configurable frameworks, not orders about game design. Creators
may select, configure, extend, replace or omit them, and choose their own simulation,
mechanics, content, devices, quality and workflow. Agents follow that direction,
including changes to stock defaults. Repository contribution gates describe our
baseline; they are not universal rules for independent games. The
[creator contract](CREATOR-CONTRACT.md) explains each party's responsibilities and
the difference between framework guarantees and application evidence.

## Defined outcomes

| Goal | Required outcome | How success is assessed |
|---|---|---|
| General applicability | Core services describe rendering, ownership, time, input, assets and persistence without requiring a particular world or gameplay model. Optional kits compose domain behavior. | Engine boots with zero kits; different diagnostic templates pass independently; layer and genericity checks prevent domain coupling. |
| Author productivity | Authors use typed public definitions, stable identities, schemas, generators and recipes. Adding a consumer does not require editing unrelated runtime internals. | New definitions are registered through their declared extension seams; examples compile through public APIs; errors identify invalid definitions. |
| Quality floor | Preserve authored intent, simulation rules, interaction correctness, legibility, accessibility and required feedback across supported quality tiers. | An application's brief defines quality and devices; visual/interaction evidence accompanies performance changes; lower tiers do not remove required content or change simulation rules. |
| Predictable performance | Bound startup, work queues, CPU/GPU resources, allocation and retained memory. Render only when state changes. | Existing scene/bundle limits pass on the exact revision; repeated visits and overload tests show bounded ownership; idle consumers do not continuously redraw. |
| Safe lifetime and recovery | Every allocation, asynchronous operation, callback and shared resource has an owner and retirement contract. Failure leaves an explicit recoverable state. | Cancellation, late completion, replacement, context loss and throwing cleanup are tested; pending work is not treated as reclaimed memory; preparation failure preserves active data where the handover contract allows. |
| Consistent interaction | Input actions are independent of keyboard, pointer, touch and controller devices, and obey focus/layer ownership. Text uses the localization system and presentation supports the declared accessibility profile. | Supported-device diagnostics prove reachable actions, reliable cancellation and no stuck input after focus or owner loss. Application layouts still need their own device acceptance. |
| Reproducible simulation | One owned timeline and explicit fixed-step systems separate simulation from rendering. Randomness and inputs are controlled for tests. | Seeded scenarios and relevant fixed-step tests reproduce outcomes under defined inputs and timing; rendering quality does not alter the simulation rule. Cross-platform bit identity is not assumed. |
| Durable data | Typed, versioned save sections preserve stable identities and migrate older data. Unreadable data is preserved for recovery. | Migration, quarantine, reload and coupled-state tests pass; updates do not silently destroy data or reset valid progress. |
| Extensible architecture | Dependencies flow downward; typed services, events and registry ids connect owners. Backends and optional capabilities fit explicit seams. | A new capability has a named owner, contract and bounded consumer; core never imports optional kits; no competing scheduler, resource cache or registry is added without justification. |
| Maintainability | Ownership, error behavior and limits are understandable from APIs and documentation. Tests cover externally observable behavior and failure boundaries. | Type/layer checks, focused regressions, API recipes, decision records and source-linked evidence remain current. Duplicated implementations and hidden shared state are removed when a common owner is justified. |
| Trustworthy tools | Validation, diagnostic scenes, profiling, publication and release checks make defects observable and changes reviewable. | Checks operate on the actual candidate revision; failed preparation/build/publication preserves the last valid state; measurements identify their harness and limits. |
| Open collaboration | The engine can be built, studied and contributed to independently, with explicit licensing, notices and contribution rules. | Clean checkout/archive builds, documented workflows and accurate dependency notices. The code license is GPL-3.0-only; repository visibility and package publication remain explicit release actions. |

## Performance and quality are joint requirements

An optimization must preserve the defined quality floor and satisfy the relevant
performance budget. Silently weakening a check or omitting promised content is not an optimization.
Creator-directed changes to budgets, quality or scope are valid; report the changed
requirement and evaluate the result against it. Prefer shared immutable data, avoided work, incremental updates,
instancing, bounded detail selection and lazy loading when they preserve the
consumer's contract. Record any quality-tier differences explicitly.

There is no universal measured frame-rate guarantee for all hardware or arbitrary
authored content. Each application must name supported devices, quality expectations
and acceptance thresholds. The repository's application annex still has a reference
hardware placeholder; software-rendered gate results are not physical-device
certification. Defining and measuring representative hardware remains necessary
before making such a claim.

## Engine, kits and applications

The engine supplies mechanisms. Kits offer reusable optional policies or domain
patterns. Independent applications own their content, aesthetics, rules, balancing,
world scale and audience. Diagnostic templates prove a mechanism in use; they are
not a product-content roadmap.

Research across terrain, geometry, rendering, animation, navigation, physics,
input, audio, tooling, debugging and persistence informs improvements. A studied
feature becomes implementation work only after its owner, consumer, limits, quality
criteria and regression evidence are defined. No source project's feature list
is automatically Foundation's backlog.

## Completion and current boundaries

Individual upgrades have finite acceptance criteria and can be completed. A reusable
engine is not meaningfully certified as 100 percent of all possible capabilities.
Distinguish implemented contracts, measured evidence, unresolved limitations and
candidate extensions in every status report.

Current examples of candidates include cross-region terrain precision/coverage,
additional navigation geometry adapters, incremental content compilation, prepared
audio cues, and bounded editor transactions. Research notes describe proposals;
they do not establish implementation, integration or release.

See the [implementation inventory](../templates/expedition/UPGRADE-STATUS.md),
[research evaluation criteria](research/README.md), [roadmap](ROADMAP.md), and
[architecture standard](STANDARD.md).

Device outcomes follow [DEVICE-EXPERIENCE.md](policy/DEVICE-EXPERIENCE.md);
[current enforcement gaps](guides/device-acceptance-gaps.md) remain explicit.

Authors may prioritize maximum quality on a single device family or choose explicit
cross-platform tradeoffs. Distinct device editions may have different declared
content/mode scopes and quality floors; one lowest-common-denominator product is
not an engine goal. Support selection follows DX-0 of the device policy.
