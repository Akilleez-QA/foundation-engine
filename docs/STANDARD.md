# Engine Architecture Standard

| | |
|---|---|
| **Document** | ENGINE-STD-001 |
| **Revision** | 3 (2026-09-30) |
| **Status** | Default engineering contract for this repository and applications choosing its stock workflow. |
| **Scope** | The supplied frameworks, their documented guarantees and this repository's build and verification workflow. Independent creators may configure, extend, replace or omit frameworks and adopt an amended application contract. |
| **Codifies** | The decisions in [adr/](adr/README.md) |
| **Annex** | [APPLICATION.md](APPLICATION.md) applies each clause to a concrete game: its scenes, measured budgets, concrete mechanisms and exceptions. This repository ships it as a template filled in for the starter game. |

This standard keeps a game **extensible, performant and beautiful** as it grows. It never gives up quality or experience to get there. It is the frame: it names systems, contracts and invariants. It never names a particular scene, object, measured number or library call; those belong in APPLICATION.md, linked to the clause they apply (STD-GOV-20).

The requirements below describe the stock frameworks and workflow, not universal
rules for designing games. Creators choose which mechanisms to use and may adapt
their interfaces, limits, implementations and verification workflow. A replacement
states its own behavior and evidence instead of claiming guarantees from a framework
it no longer uses. Inside this repository, the existing checks remain the agreed
baseline until an explicit change updates them. [ADR 0076]

---

## The laws

There are twelve laws. Every clause below elaborates one of them. A design that satisfies every clause and still breaks a law is wrong.

1. **The reference machine is the design bar.** Everything is authored at full quality for the reference preset first. Each advertised device has a separately accepted experience, using knobs, asset variants and swappable implementations. *(§1.2)*
2. **Preserve the creator's quality floor.** Optimize mechanisms against the declared experience. Creator-directed changes may revise that experience; they are recorded as changes to the requirements, not presented as equivalent optimizations. *(STD-PRI-5, chapter 14)*
3. **Dependencies point down.** Each system sits in one layer and depends only on the layers below it. The only upward path is a port that the lower layer declares. *(chapters 2 and 3)*
4. **An addition is one folder or one row.** Adding a scene, activity, pack, control, save section or budget touches nothing outside its own folder or row. Every shared surface derives from registered data. *(chapter 5)*
5. **Every open set is a registry.** Rows are typed data, validated at boot and then frozen. Behaviour is lazy and bound by id at an async boundary, never per frame. A missing implementation becomes an honest, reported placeholder, never a crash or a fake. *(§5.2 to §5.4)*
6. **Systems meet through three contracts only.** Services carry commands, events report the past, and registry ids name things. Nothing polls, and nothing is emitted per frame. *(chapter 6)*
7. **Time has one owner.** One clock advances, and only through the frame loop. Randomness is seeded. Simulation fidelity is a game rule, identical on every machine. *(chapter 7)*
8. **The frame is never blocked.** A frame renders only when something changed. No frame waits on a worker, a file or a program link. Activation never blocks on resource preparation. *(chapters 4 and 10)*
9. **Saved data loads forever.** It is versioned and migrated. It is quarantined when unreadable, never overwritten or silently defaulted. Ids are never renamed. *(chapter 8)*
10. **What you create, you own; what you share, you lease.** Every resource has one owner lifetime. Shared resources are immutable, reference-counted leases, and no consumer disposes one. *(§4.3, §9.4)*
11. **Budgets are contracts.** Every scene declares measured budgets, and the gate enforces them before every integration. Budgets fall by ratchet and rise only by a reviewed exception. *(chapter 13)*
12. **Support the creator's player promises.** Persistence preserves valid state and reports failures. Creators define progression, loss, reset and recovery rules. A game may adopt a stricter policy profile, such as the [kid-safe profile](policy/KID-SAFE.md). *(STD-PRI-7)*

---

## Conventions of this document

**Key words.** MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are used as defined in RFC 2119 and RFC 8174 when written in capitals.

**Clause IDs.** Clause IDs have the form `STD-<PREFIX>-<n>`. An ID is stable: it is never renumbered or reused (STD-GOV-14). The numbering has gaps, and a missing number is reserved. Code cites clauses by ID.

| Prefix | Chapter | Prefix | Chapter |
|---|---|---|---|
| `PRI` | 1 Scope and principles | `SAV`, `SET` | 8 Persistence and settings; 9 quality tiers |
| `SYS` | 2 System map | `REN` | 9 Rendering, quality and assets |
| `LAY` | 3 Layers | `RUN` | 4 Lifecycle; 10 Frame and concurrency; 11 Input and UI |
| `MOD` | 4 Lifecycle; 5 Extension model | `STR` | 12 Strings |
| `REG` | 5 Extension model; 6 Contracts | `PRF` | 13 Performance budgets |
| `EVT` | 6 Contracts between systems | `TST` | 14 Testing and the quality guard |
| `SIM` | 7 Time and determinism | `GOV`, `CNF` | 15 Change control; 16 Conformance |

**References.** `[ADR 0031]` points to an ADR, and `[A§4]` to a section of APPLICATION.md.

**Provisional.** A clause marked **Provisional** is binding in its stated form until its named open question is answered. It is then confirmed or amended through §15.4. It is never silently resolved by code.

**Rationale.** A clause carries at most one short line of rationale, marked *Why*.

---

## 1. Scope and principles

### 1.1 Scope

- **STD-PRI-1.** This standard governs a game's structure:
  - its systems and their boundaries, layers, lifecycle and extension model;
  - the contracts between systems;
  - the cross-cutting concerns: time, persistence, rendering, input, text, assets, concurrency and performance;
  - verification and change control.

  It does not govern art direction, game design or writing beyond the rules stated here.
- **STD-PRI-2.** APPLICATION.md records the chosen application contract: adopted defaults, deliberate amendments, measured budgets and evidence. A build claiming unchanged conformance follows this standard; an explicitly amended application describes its chosen behavior and checks. Unrecorded contradictions are defects, not implicit amendments. [ADR 0001; ADR 0076]
- **STD-PRI-14.** **Malleable frameworks.** The engine MUST provide configurable, replaceable extension contracts rather than prescribe application mechanics. Creators choose requirements and may use, extend, replace or omit mechanisms. Agents implement that direction while making behavior, cost and compatibility changes explicit. A framework describes its owner, inputs and outputs, configured bounds, overload and cancellation behavior, recovery and evidence. Runtime enforcement, build-time checks and manual acceptance MUST be distinguished. Runtime rules do not depend on the identity of the implementation author. [ADR 0076; CREATOR-CONTRACT.md]

### 1.2 The design bar

- **STD-PRI-3.** Each game names its **reference machine** in APPLICATION.md: CPU, memory, GPU, display resolution and refresh rate. That machine is the design bar. [ADR 0029]
- **STD-PRI-4.** Every feature MUST be designed and authored at full quality for the `reference` preset first. Lighter presets use knobs, asset variants and swappable implementations. Device support is author-selected; every advertised device experience MUST be designed and accepted before release; reference-first graphics does not excuse missing interaction design for any advertised target. No feature may hard-code a device decision that a knob should own. [ADR 0029; ADR 0068]
- **STD-PRI-5.** An optimization MUST preserve the declared visual quality, correctness, feel, accessibility and required experience. Creators may revise those requirements deliberately, with the changed scope and evidence recorded. Within an unchanged shared experience, lower presets scale cost while preserving required content, information and rules. Separate editions may have different content, modes and quality floors; unsupported targets impose no constraints on them. Layouts may reorganize information and reveal detail on demand. [ADR 0017; ADR 0076]
- **STD-PRI-6.** Each scene MUST meet the creator's declared timing and resource targets on the named reference configuration while preserving its declared quality floor. The creator chooses these targets; display refresh is not a universal minimum simulation or rendering rate. Measurements follow chapter 13. [ADR 0030; ADR 0076]

### 1.3 Principles

- **STD-PRI-7.** **Player protection.** A game MUST state in APPLICATION.md which guarantees it gives its players, and MUST enforce them in types and data, not by convention. The engine's own defaults are these:
  - valid saved state is preserved across infrastructure failures; unreadable data is quarantined rather than silently reset;
  - creators choose state transitions and merge semantics, including deliberate loss, reset or rollback where their design calls for it. Maxima and unions are available policies, not mandatory game rules.

  A game that grants rewards states its own rules in APPLICATION.md. The opt-in [kid-safe profile](policy/KID-SAFE.md) (brief `audience.kids: true`) adds stricter rules.
- **STD-PRI-8.** **The fast path is the default path.** A shared system MUST make the efficient behaviour happen without any per-feature effort. A feature MUST NOT have to opt in to performance.
- **STD-PRI-9.** **Generalise what already works.** When the game already contains a proven mechanism, a shared system MUST generalise it instead of adding a parallel path.
- **STD-PRI-10.** **Extension costs one folder.** Adding a scene, activity, pack, control or save section MUST touch only its own folder or data row (§16.2 measures this). [ADR 0036; ADR 0043]
- **STD-PRI-11.** **Honest degradation.** When something is missing (a pack, an implementation, a GPU context, a string, a worker), the game MUST:
  - degrade visibly and explain itself to the player;
  - keep the player's data intact;
  - report the problem to developers.

  It MUST NOT crash, silently substitute a value or fake a result. [ADR 0043]
- **STD-PRI-12.** **Reference sources inform; code is fresh.** External references MAY inform ideas, maths and visual reference. Shipped code and art MUST be written fresh. The exception is permissively licensed code, which may be ported with its notice kept in THIRD_PARTY_NOTICES.md.
- **STD-PRI-13.** **Specifics teach the frame.** A concrete case that no clause covers is evidence that a clause is missing. It is recorded in APPLICATION.md against the nearest clause and raised as a defect against this standard. It is never solved by a one-off exception in code.

---

## 2. The system map

- **STD-SYS-1.** A game is composed of the systems in this chapter. Every module MUST belong to exactly one system, and every system to exactly one layer (chapter 3).
- **STD-SYS-2.** A system MAY depend only on the systems its table names and on systems in lower layers. Dependency is by service, event, registry id or port (chapter 6), never by reaching into another system's internals. [ADR 0031]
- **STD-SYS-3.** Adding, splitting or merging a system requires an ADR and a new or amended table in this chapter. A capability that fits no system's responsibility is a defect against this chapter (STD-PRI-13), not a reason to put it in the nearest system.
- **STD-SYS-4.** Each system owns its state and its data formats. Only the owner writes its state, emits in its event area and provides its services (STD-EVT-3, STD-EVT-11).
- **STD-SYS-28.** **Placement test.** A capability belongs to the system that owns the row or state it acts on.
  - Where a capability has both a policy and a mechanism, the policy sits with the row's owner and the mechanism with the resource's owner, joined by a service or an event.
  - Presentation of a domain outcome belongs to the UI shell or a kit, never to the domain system that produced it.

  *Why:* the map only holds if every new capability has exactly one obvious home.

### 2.1 Kernel systems (L0, `src/core/`)

| Clause | System | Owns | Invariants |
|---|---|---|---|
| **STD-SYS-5** | Module kernel | Boot phases and report, the service table, the event bus, probes, module disable and cascade, installed availability | Boot never fails on one bad module; phases run in order; no string-token lookup |
| **STD-SYS-6** | Registries and patches | Registry lifecycle (define, add, patch, freeze, validate), aliases, the patch log, lazy behaviour binding and placeholders | Frozen after patch; ids validated and never renamed; behaviour bound only at async boundaries |
| **STD-SYS-7** | Save store | The storage port, sections, migrations, flush scheduling, quarantine, the player roster | Saves load forever; unreadable data is never overwritten; no storage work inside a frame |
| **STD-SYS-8** | Settings and quality | Setting and flag definitions, presets, knob resolution, device detection and its reasons | Nothing overrides the player's choice; knobs respect content floors; only this system queries device capability |
| **STD-SYS-9** | Time | The game clock, warp, pause, schedules, time away, seeded randomness, the wall-clock facade | Time advances only through the loop; no wall clock or unseeded randomness outside this system |
| **STD-SYS-10** | Router and activity runtime | Scenes, panels and routes, navigation epochs, prefetch, activity lifetimes, the frame loop and coverage | One frame loop; frames on demand; dormant preparation; activation exactly once per epoch |
| **STD-SYS-11** | Strings | Key types, catalogues generated from shards, plural rules, reading levels | No literal UI text; per-key fallback |

### 2.2 Platform systems (L1, `src/platform/`)

Platform systems know no game noun (STD-LAY-5).

| Clause | System | Owns | Invariants |
|---|---|---|---|
| **STD-SYS-12** | Render | GPU contexts by role, the render profile, shadow scheduling, change tracking, batching, program preparation | One render path; nothing redraws when nothing changed; light count fixed per scene |
| **STD-SYS-13** | Assets | The asset manifest, the lease cache, variant selection, painted-surface residency | Assets are addressed by id; shared resources are immutable and leased; nothing uploads after its owner is gone |
| **STD-SYS-14** | UI shell and layers | The layer stack, focus, inertness, Back, shell button rows, notifications, the style cascade and tokens, the scene shell | Nothing bypasses the layer stack |
| **STD-SYS-15** | Input | Input actions, bindings and remaps, dispatch order, owner epochs | Every action is reachable on every device; a press is dispatched once |
| **STD-SYS-16** | Audio | The one audio output, cues, music, spatial voices (panning and distance models, audible cutoff, HRTF voice limit, filter stage, smoothing; [guide](guides/spatial-audio.md)) | Never touches the user's system or application audio; silent in tests; HRTF is bounded separately and falls back to equal-power, never refusing playback |
| **STD-SYS-17** | Workers | Thread creation, bounded admission, the pool, job registry, cancellation | Only this system creates threads; jobs are pure; the frame never awaits a job |
| **STD-SYS-18** | Performance instrumentation | The perf schema, window classification, budget checking | Costs nothing in production; no number leaves the device |

### 2.3 Domain systems (L2, `src/domain/`)

Domain systems touch neither the DOM nor the rendering library (STD-LAY-4).

| Clause | System | Owns | Invariants |
|---|---|---|---|
| **STD-SYS-19** | Maths | Pure numerical code: vectors, integration | Imports nothing; runs identically in workers and tests |
| **STD-SYS-21** | Simulation | Fixed-step hosts, force stages, tick-addressed input | Deterministic; fidelity is a game rule; world time committed once |
| **STD-SYS-23** | Game state (author layer, `src/author/`) | A scene's world (entities, components, systems, resources), save sections, modes, the build brief | Systems read input actions, never devices; fixed systems are deterministic; state that outlives a visit is a save section |

A game adds its own domain systems (for example an economy or a world model) with a table in APPLICATION.md.

### 2.4 Presentation, features and composition

| Clause | System | Owns | Invariants |
|---|---|---|---|
| **STD-SYS-24** | Kits (`src/kits/`) | Optional genre patterns built on the author API (camera, character, explore, ui, learn), chosen by a game in `defineGame({ kits })` | core, platform and author never import a kit; a kit declares the kits it needs; the engine works with none |
| **STD-SYS-25** | Features and packs (L3) | One folder per engine-level feature or content pack: its manifest rows, lazy body, shards and budgets | A feature never imports another feature; adding one touches nothing outside its folder |
| **STD-SYS-26** | Composition root (L4, `src/app/`) | Discovery lists for kernel and platform modules; the game (`@game`) compiled by the author layer, with its kits | No hand-kept feature list |
| **STD-SYS-27** | Verification and the gate (tooling) | The gate, deploy guard, bench, quality guard, typed test API, ratchet baselines | Gates pin the preset; evidence is raw and keyed; baselines only fall |

---

## 3. Layers and dependency direction

- **STD-LAY-1.** Source code MUST live in exactly one of these layers, and dependencies MUST point downward only. [ADR 0031]

| Layer | Folder | May depend on |
|---|---|---|
| L0 | `core/` | nothing above L0 |
| L1 | `platform/` | L0 |
| L2 | `domain/` | L0, and `platform/workers/` job contracts (no DOM, no rendering library) |
| L2.5 | `kits/` | L0 to L2, content types, the rendering library, the DOM |
| L3 | `features/`, `packs/` | L0 to L2.5 |
| L4 | `app/` | anything; features only through their manifests |
| none | `content/` | types from L0 to L2.5 |
| none | `dev/`, `testing/` | anything; product code never imports them |

- **STD-LAY-2.** A feature MUST NOT import another feature. Features communicate only through services, events and registry ids.
- **STD-LAY-3.** Pure maths (`domain/math/`) MUST import nothing, so it runs in workers and tests. [ADR 0010]
- **STD-LAY-4.** Domain systems MUST NOT touch the DOM or the rendering library. Domain-to-GPU binding lives in kits.
- **STD-LAY-5.** Platform systems MUST depend only on the kernel and MUST NOT know a game noun. Anything that does belongs in a kit or higher. [ADR 0031]
- **STD-LAY-6.** A kit MUST have at least two feature importers. A kit with one importer moves back into that feature. A kit MUST NOT import a feature. [ADR 0031]
  *Why:* kits must not become a dumping ground.
- **STD-LAY-7.** **Ports are the only upward mechanism.** A lower layer that needs something from above MUST declare the smallest interface that meets the need. The higher layer implements it and hands it in at install. [ADR 0031]
- **STD-LAY-8.** Sim-to-render adapters are split:
  - noun-free buffer writers live in render and update pre-allocated buffers in place;
  - the binding from domain types to those writers lives in the kit that draws them.
- **STD-LAY-9.** Dependency direction and owned capabilities MUST be enforced mechanically in the test run. Known violations live in sharded baselines, whose counts MUST only fall. [ADR 0036]
- **STD-LAY-10.** **Owned capabilities.** Each capability with a global effect MUST be used only by its owning system. Every other use is a ratchet violation.

| Capability | Owning system |
|---|---|
| Frame scheduling | Router and activity runtime (the frame loop) |
| GPU context creation, lights, tone mapping, shadow update policy | Render |
| File loading and decoding | Assets |
| Thread creation | Workers |
| Persistent and session storage | Save store (storage port) |
| Device capability, pixel ratio and reduced-motion queries | Settings and quality; render's quality profile |
| Global key listeners | Input |
| Top-of-screen stacking | UI shell |
| Wall clock, high-resolution time, randomness | Time (in the kernel) |
| Audio contexts | Audio |
| Recurring timers for game work | Nobody: timers belong to the clock or the save store |
| Serialised state in DOM attributes | Nobody |

---

## 4. Lifecycle: boot, activities and handover

### 4.1 Boot

- **STD-MOD-13.** Boot MUST run these phases in order: `discover → register → patch → freeze → validate → install → start`. [ADR 0003]
- **STD-MOD-14.** Discovery MUST order modules by their declared requirements (a topological sort). Ties MUST break by layer, then by module id, never by list position. [ADR 0036]
- **STD-MOD-15.** Missing or out-of-range dependencies, conflicts and cycles MUST disable the affected modules and report them. They MUST NOT be fatal.
- **STD-MOD-16.** Nothing runs during `register`: modules only add definitions, including save sections and knobs.
- **STD-MOD-17.** In `validate`:
  - development and test builds MUST fail boot with one error that lists every problem sourced by a kernel, platform, domain, kit or feature module;
  - production MUST log and drop the bad entry;
  - problems sourced by a pack MUST disable that pack, roll back its entries and be reported, in every build mode.

  [ADR 0043]
- **STD-MOD-18.** In `install`, the save store is built from the frozen section registry before any module that persists installs. A module whose install throws MUST be disabled and reported. Its dependants cascade to disabled, and boot continues.
- **STD-MOD-19.** In `start`, the router resolves the current scene and loads it lazily. Every scene change is a handover (§4.3).
- **STD-MOD-21.** Discovery eligibility MUST be distinct from successful installation.
  - Before start, the kernel MUST publish one availability snapshot, after required-dependency failure has propagated.
  - Install wires owned resources; automatic gameplay starts only after this boundary.
  - A foundational failure MUST expose recovery without changing saved state.

  [ADR 0063]

### 4.2 Activities

- **STD-RUN-6.** Every scene, panel, minigame and widget MUST be an **Activity** whose `enter` returns a per-visit **run**. The run has hooks for update, render, frame mode, coverage behaviour, readiness, activation, leave and context restore. [ADR 0032]
- **STD-RUN-7.** Everything a run creates MUST be owned through the run's lifetime signal or ownership list and released in reverse order. Child runs leave before their parent. A throwing `enter` releases everything it owned and is reported once. [ADR 0032]
- **STD-RUN-8.** Motion MUST read Calm from the frame. State changes MUST invalidate the frame. [ADR 0032]
- **STD-RUN-10.** Scenes MUST be rows in the router's registry; a scene's address is `#scene/<id>` with query parameters. [ADR 0022; ADR 0043]
- **STD-RUN-11.** Navigation MUST go through the router with explicit parameters. Redirects are data rows. There is no module-level pending state, and nothing outside the router writes the address. [ADR 0022]
- **STD-RUN-12.** Each scene loads as its own chunk. Superseded loads are dropped. A failed load can be retried and shows one recovery layer with Retry and Back. Prefetch is declared per scene. [ADR 0022]
- **STD-RUN-13.** Shell surfaces that list scenes (breadcrumb, map, accessible grid, page heading) MUST be generated from the scene rows.

### 4.3 Handover and activation

- **STD-RUN-14.** A scene change MUST capture one navigation epoch (epoch, player, destination, parameters) before it starts, and every awaited boundary checks it.
  - A newer request, a player change, Back, a timeout or a failure aborts the pending context and disposes its resources exactly once.
  - A stale load MUST NOT enter.
  - A late result is disposed without activation.

  [ADR 0045]
- **STD-RUN-15.** **Preparation is dormant.** `enter` builds private state, leases assets and prepares programs. Its layer is inert and excluded from music, narration and input. During preparation, no gameplay ticking, timers, facts or automatic narration run. [ADR 0045]
- **STD-RUN-16.** `ready` means prepared, not arrived. The sequence is:
  1. The current epoch's run receives a first render.
  2. After a final epoch and player check, activation runs. It is synchronous and infallible, and makes no multi-key saves.
  3. The epoch is checked again.
  4. The entered event is emitted exactly once.

  [ADR 0045; ADR 0041]
- **STD-RUN-17.** The router's shell owns the presentation between scenes: a loading card after a declared delay, a failure card with Retry and Back, and optionally a held image of the old scene. On context loss, a DOM recovery layer replaces any GPU hold. [ADR 0041; ADR 0045]
- **STD-RUN-18.** Music and narration change context at activation. Held input is cleared, and a fresh press is required at activation. [ADR 0041; ADR 0047]
- **STD-REN-37.** **Activation never blocks on resource preparation.** Every GPU program a scene's first presented frame needs MUST be prepared before activation. Programs created after activation are counted per window, and the reference target is zero.

---

## 5. The extension model

### 5.1 Modules and the folder

- **STD-MOD-1.** Every unit of installable behaviour MUST be a **module**. It has an id and a semantic version, and optionally requirements, soft dependencies, conflicts, provisions, a reference budget, registry definitions, registrations, patches and an install. [ADR 0003]
- **STD-MOD-2.** Module ids MUST be prefixed by layer (`core.`, `platform.`, `domain.`, `kit.`, `feature.`, `pack.`) and MUST NOT be renamed.
- **STD-MOD-3.** A module that uses another module's registry or service MUST require it, optionally with a version range. A soft dependency MUST be declared and checked before use.
- **STD-MOD-4.** Module budgets (boot time, chunk size, idle heap) are reference values. The boot report warns on them and never fails.
- **STD-MOD-5.** Anything a module creates in install MUST be owned through its lifetime signal or a returned disposable.
- **STD-MOD-6.** A feature or pack folder MUST have exactly one eager **manifest** (`index.ts`). It exports the folder's module and registry rows: scenes, save sections, input actions, knobs and string keys. [ADR 0036]
- **STD-MOD-7.** Everything else in the folder (activity code, art, styles, large tables) MUST be reachable only through a lazy load. The static import closure of every manifest MUST contain only kernel types, module and lazy helpers, manifest data and core content. [ADR 0036]
- **STD-MOD-8.** Manifest data MUST import only types and other manifests' data.
- **STD-MOD-9.** Folder-local data MUST be sharded in the owning folder: strings, asset declarations and performance baselines. [ADR 0043]
- **STD-MOD-10.** Generated artefacts (string catalogues, key types, the asset manifest) MUST NOT be committed. The gate and the deploy guard rebuild them. [ADR 0043]
- **STD-MOD-11.** The composition root MUST discover features and packs by folder convention, plus short lists of kernel, platform, domain and kit modules. There MUST be no hand-kept list of feature or pack modules. [ADR 0036; ADR 0043]
- **STD-MOD-12.** A test MUST assert that every feature and pack folder on disk produced exactly one discovered module. [ADR 0043]

### 5.2 Registries

- **STD-REG-1.** Every open set of things the game knows about MUST be a registry, with per-row validation, set-level problems and aliases. A closed type union MUST NOT stand in for an extensible set. [ADR 0005; ADR 0043]
- **STD-REG-2.** A registry is created per app from its owner module's definitions. Other modules add rows in `register`, with their module id as the source. [ADR 0005]
- **STD-REG-3.** Registries MUST freeze after the patch phase and be read-only afterwards. [ADR 0005]
- **STD-REG-4.** Every registry MUST validate each row and the set as a whole (duplicates, broken references). A mistyped id MUST fail validation against the registry, not pass as a string. [ADR 0005]
- **STD-REG-5.** Rows MUST be eager and data-only. Heavy payloads MUST be lazy fields that load with their scene's chunk.
- **STD-REG-6.** Registries that packs extend MUST stay open. APPLICATION.md lists the open set. [ADR 0043; ADR 0044]
- **STD-REG-28.** Definition identity MUST be separate from executable availability. Consumers MUST use the kernel-owned availability decision before invoking registered behaviour. Unavailable definitions and their saved identities MUST remain inspectable and recoverable. [ADR 0063]

### 5.3 Lazy binding

- **STD-REG-7.** Every behaviour registry row MUST be data plus a lazy implementation. Rows MUST NOT hold eager functions. [ADR 0043]
- **STD-REG-8.** Consumers MUST bind implementations by id at a natural async boundary (readiness, scene load, program preparation), never per frame. [ADR 0043]
- **STD-REG-9.** An id whose row or implementation is missing MUST bind to a placeholder that is marked invalid, reported and explained to the player. It MUST NOT throw in a hot path. Saved data naming it MUST be kept verbatim. [ADR 0043]

### 5.4 Content

- **STD-REG-10.** Content MUST be typed source. Plain data files are permitted only for large generated data and text shards. [ADR 0005]
- **STD-REG-11.** Every content file MUST be registered by exactly one module. Core content holds only cross-feature data; feature and pack data lives in the owning folder.
- **STD-REG-12.** Ids MUST be lowercase kebab-case, namespaced by kind where ambiguous, and MUST NOT be renamed; renames use aliases. Ids that are already save data keep their stored form (an id that is already stored keeps its stored spelling).
- **STD-REG-13.** Physical field names MUST carry their unit.
- **STD-REG-14.** Every physical fact MUST have one source row.

### 5.5 Content packs and patches

- **STD-REG-15.** A content pack MUST be a folder with the feature anatomy (§5.1), a `pack.` id prefix and the rules of features. [ADR 0043; ADR 0031]
- **STD-REG-16.** A pack changes existing content only through patches applied in the patch phase (add, edit or merge, copy, remove).
  - Patches are ordered by declared dependencies and before/after constraints, deterministically.
  - Every change is logged against its source pack.
  - Every skipped or throwing patch is reported with its reason.

  [ADR 0006]
- **STD-REG-17.** Ordering by name tricks MUST NOT be used. `final` patches are allowed only for packs, and the kernel checks this at boot.
- **STD-REG-18.** A switchable pack MUST gate its patches on a feature-flag row.
- **STD-REG-19.** A fact verb defined by a pack MUST be prefixed with the pack's name. [ADR 0043]

### 5.6 What an addition touches

- **STD-MOD-20.** Every kind of addition MUST have one home, and the shared systems MUST pick it up from its row. The recipes are in [recipes/](recipes/). [ADR 0036; ADR 0043]

| Addition | Home | Picked up by | Recipe |
|---|---|---|---|
| Scene | `defineScene` in the game folder: scene row, route `#scene/<id>`, lazy body | Router, scene shell, handover, bench, gate | [add-a-scene](recipes/add-a-scene.md) |
| Entity, component | `defineEntity` / `defineComponent` next to the scene that uses them | The scene's world, renderer, test API | [add-an-entity-and-component](recipes/add-an-entity-and-component.md) |
| Logic | `defineSystem` (fixed step or per frame) | The system runner on the one frame loop | [add-a-system](recipes/add-a-system.md) |
| Kit | `src/kits/<name>/` with `defineKit`, chosen in `defineGame({ kits })` | The author compiler; the layer lint | [add-a-kit](recipes/add-a-kit.md) |
| Saved state | Save section in the owner folder, with a migration per version | Store: export, import, reset, quarantine, players | [add-a-save-section](recipes/add-a-save-section.md) |
| Control | Input action row | Dispatcher, reach check, remaps | [add-an-input-action](recipes/add-an-input-action.md) |
| Budget | Scene row in the game's `budgets.json` | Bench, gate, ratchet | [add-a-budget](recipes/add-a-budget.md) |
| Worker job | `src/kits/<kit>/workers/<name>.job.ts` (row `job.kits.<kit>.<name>`) or the domain equivalent | Worker host loader table, main-thread fallback | [generate-seeded-content](recipes/generate-seeded-content.md) |
| Content pack | Pack folder: rows, patches, lazy behaviour | Registries; a failing pack disables only itself | |
| Registry | Owner module definition | Boot validation, registries test | |
| Event, service | Augmentation in the owner's folder | Bus, service table, test API | |
| Setting, knob | Definition row with a value per preset | Settings panel, quality profile | |
| String | Folder shard | Catalogue and key generation | |

---

## 6. Contracts between systems

### 6.1 Events

- **STD-EVT-1.** Cross-module notifications MUST use the typed kernel bus. Each module declares its events in its own folder. DOM events are permitted only for DOM concerns. [ADR 0004]
- **STD-EVT-2.** Event names MUST follow `<area>.<verb-past>` or `<area>.<noun>.<verb-past>`. [ADR 0004]
- **STD-EVT-3.** Each event area MUST be reserved by exactly one owning module, and only that module emits in it. [ADR 0004; ADR 0063]
- **STD-EVT-4.** Events MUST report the past. A request to do something MUST be a service method. [ADR 0004]
- **STD-EVT-5.** Nothing MUST be emitted per frame. [ADR 0004]
- **STD-EVT-6.** Delivery is synchronous and in subscription order. A throwing listener MUST be isolated from the others.
- **STD-EVT-7.** Every listener MUST be tied to its owner's lifetime signal. [ADR 0004]
- **STD-EVT-8.** State changes MUST be observed by event or subscription, never by polling.

### 6.2 Services and ports

- **STD-EVT-9.** Services are typed properties of the service table, declared by augmentation and provided exactly once by their owning module in install. There is no string-token lookup.
- **STD-EVT-10.** Reading a service that is not provided MUST fail with a message that names the missing requirement.
- **STD-EVT-11.** Every service has exactly one owning module, declared in its `serviceKeys`. Service and event-area claims MUST be validated before installation and enforced at provision and emission. [ADR 0063]
- **STD-EVT-12.** A service that holds testable state MUST contribute its own probes. Development tooling never reaches into features.
- **STD-EVT-13.** A port is declared in the lower layer as the smallest interface that meets the need, and MUST NOT expose a type from a higher layer. [ADR 0031]

### 6.3 Game state

- **STD-REG-20.** State that outlives a scene visit MUST be a save section with a version and a migration per older version; state inside a visit lives in the scene's world (components and resources).
- **STD-REG-22.** Systems read input as named actions and axes (`ctx.input`), never raw devices, and talk to each other through world events (`ctx.world.emit` / `read`), never through each other's code.
- **STD-REG-23.** A `fixed` system MUST be deterministic: the same seed and the same inputs give the same world after N steps, on every machine.
- **STD-REG-24.** Anything a game grants the player (points, unlocks, items) MUST be granted idempotently: granting twice is granting once.

### 6.4 Rendering boundaries

- **STD-REN-33.** Resources MUST be reference-counted leases, deduplicated per asset, variant and context. A consumer MUST NOT dispose a shared resource. Every load takes its owner's signal, so nothing uploads after dispose. [ADR 0016]
- **STD-REN-34.** Ownership is split three ways:
  - renderer leases own contexts;
  - asset leases own shared immutable resources;
  - an activity run owns its mutable scene instances. A live scene is never transferred.

  [ADR 0040]
- **STD-REN-36.** Sim-to-render updates MUST write pre-allocated buffers in place. Nothing rebuilds geometry per frame.

---

## 7. Time and determinism

### 7.1 The clock

- **STD-SIM-1.** There is one game clock per player, persisted. [ADR 0033]
- **STD-SIM-2.** Game time MUST advance only through the loop, and only while playing. [ADR 0033]
- **STD-SIM-3.** The clock has two interfaces. Every module gets the read interface. The driver interface is held only by the frame loop and the save store, and this is enforced by type and lint. [ADR 0033]
- **STD-SIM-4.** The clock's wall-clock and calendar facade is the only wall clock outside the kernel, so tests can set the date. [ADR 0033]
- **STD-SIM-6.** Pause is a set of owners, not a boolean.
- **STD-SIM-7.** Warp MUST be requested by an owner, from a fixed ladder. It is capped by the active policy and released by its owner. Scheduled events fire in order.
- **STD-SIM-8.** Time away is delivered, capped, only to systems that opt in. [ADR 0033]
- **STD-SIM-9.** Randomness MUST come from seeded, named streams. Seeds MUST NOT derive from the wall clock. [ADR 0033]

### 7.2 Simulation

- **STD-SIM-10.** A simulation's fixed step, integrator and physics model are part of its definition. They are a game rule, not a quality knob, and a play MUST end the same way on every machine. Lower presets MAY change only prediction density, horizon and worker count.
- **STD-SIM-11.** Every simulation MUST step on a fixed-step host.
- **STD-SIM-12.** Input MUST be addressed to simulation ticks. Held state is timestamped. Commands carry sequence ids, are consumed exactly once, and survive zero-step frames. [ADR 0039]
- **STD-SIM-13.** A simulation declares a world or a local clock. Only persistent world state uses world time and global warp. Arcade activities use unwarped, pause-aware local time. [ADR 0039]
- **STD-SIM-14.** The loop MUST commit world time once. World hosts report what they can integrate, the driver advances by the common accepted interval, and every world host accounts for that interval. [ADR 0039]
- **STD-SIM-15.** World-host capacity MUST be derived from the maximum warp, the frame budget and the step, never hand-picked. [ADR 0049]
- **STD-SIM-17.** Determinism means that identical initial state, seed and tick-addressed input yield identical state after N ticks. Replays record the seed and tick inputs, not frame samples. [ADR 0039]
- **STD-SIM-18.** Each simulation declares its behaviour when covered: analytic, frozen or a rate.
- **STD-SIM-19.** Pause and coverage MUST release input intent and the owner's warp requests. Nothing queued leaks into the next visit or player. [ADR 0039]
- **STD-SIM-22.** Data is resolved to simulation units once, at freeze. Simulations read only the resolved form.
- **STD-SIM-23.** Display units are converted only in the formatting layer, and render scale only at the render boundary.
- **STD-SIM-24.** Numerical code MUST come from the maths library. Simulation hot paths MUST be allocation-free. [ADR 0010]

---

## 8. Persistence, settings and migration

### 8.1 Sections

- **STD-SAV-1.** All persistent state MUST be a **save section** registered by its owning module. A section has an id, a scope, a version, an initial value and a parser. It may also have migrations, legacy importers, a merge, aliases, a storage medium, a size cap and a flush policy. [ADR 0007]
- **STD-SAV-2.** Scope MUST be `player`, `profile` or `device`. The storage medium is a separate field.
- **STD-SAV-3.** The parser MUST fail on unreadable data. The store then quarantines the value and MUST NOT overwrite it.
- **STD-SAV-4.** Section ids MUST NOT be renamed. Aliases keep old ids readable.
- **STD-SAV-5.** Any change to the persisted shape or meaning MUST bump the version and add a migration from the previous version.
- **STD-SAV-6.** Migrations MUST be pure, receive a copy and never read other sections.
- **STD-SAV-7.** Every version MUST have a fixture, and a test runs every older fixture through the full migration chain.
- **STD-SAV-9.** Unknown ids in saved collections MUST be preserved as inert data. Unknown sections are kept and carried through export.
- **STD-SAV-10.** Every stored key MUST sit under the game's namespace prefix, so reset clears it. A contract test enforces this.

### 8.2 Writing

- **STD-SAV-11.** Reading a section MUST be constant-time and return the stored, frozen value. An update marks the section dirty and serialises nothing.
- **STD-SAV-12.** The store writes after an idle debounce with a bounded maximum delay, and only writes dirty sections whose bytes differ. It also writes at flush points: a hidden tab, page exit, a player switch, export, and leaving an activity.
- **STD-SAV-13.** No storage work runs inside a frame. High-frequency sections MUST declare lazy flush.
- **STD-SAV-14.** Export, import and reset MUST be generated from the registered sections. Device sections are never exported.
- **STD-SAV-15.** A profile holds many players in its roster. Switching players flushes, re-resolves handles and emits an event.
- **STD-SAV-16.** **Provisional.** State that must stay coherent MUST be kept in one physical envelope. Batching groups one flush and MUST NOT be relied on as atomicity. [ADR 0052]

### 8.3 Settings and flags

- **STD-SET-1.** Every user preference MUST be a registered setting definition, stored sparsely. The settings panel is generated from the definitions.
- **STD-SET-2.** Calm (reduced motion) is one central value, evaluated once and subscribed to. Motion systems read it from the frame or the setting, never from a DOM query.
- **STD-SET-3.** Feature flags MUST be rows, resolved in a fixed order: the address, a stored override, detection, then the default. Development flags are off in production.
- **STD-SET-4.** Nothing outside settings and the render quality profile queries device capability or reduced motion (STD-LAY-10).

---

## 9. Rendering, quality tiers and assets

### 9.1 Quality tiers

- **STD-SET-5.** The presets are `reference`, `high`, `medium` and `low`. `reference` is the reference machine's default and the only gated tier. [ADR 0029]
- **STD-SET-6.** Every device-dependent cost MUST be a registered **knob**. A knob has a value for every preset (reference authored first), a measured cost, an apply mode, a group and an owner. [ADR 0029]
- **STD-SET-8.** The graphics screen MUST be generated from the knobs. [ADR 0029]
- **STD-SET-10.** Knobs MUST declare content floors, and no preset default crosses them. Removing content is a player choice only. [ADR 0029]
- **STD-SET-11.** Detection picks a preset only on a first run, and records and shows its reasons. Nothing changes the player's choice afterwards. [ADR 0029]
- **STD-SET-12.** Any frame-time governor MUST be off by default. It moves only the resolution scale, and never runs in a gate or a bench. [ADR 0029]
- **STD-SET-13.** Graphics settings MUST live in a device section and MUST NOT be exported.
- **STD-SET-14.** The graphics screen is a preview layer: the covered scene keeps running, so changes are seen live.

### 9.2 The render path

- **STD-REN-1.** The game MUST have one render path, created only by the renderer pool. [ADR 0034]
- **STD-REN-3.** The renderer pool MUST own contexts by role. Scene changes reuse the world context, and the number of live contexts is bounded. [ADR 0016]
- **STD-REN-4.** The pool MUST reset render state on every acquire, audit leaks on release, and keep a recycle valve.
- **STD-REN-5.** Context loss MUST be handled once, in the pool: an event, a restore hook on runs, recreation after a timeout, and one generic recovery layer.

### 9.3 Light and shadow

- **STD-REN-11.** Light rigs MUST be fixed: every light is built on enter, and lights are dimmed, never added or removed.
  *Why:* changing the light count recompiles every lit material.
- **STD-REN-12.** The shadow scheduler MUST be installed for every shadow-casting light, and no scene can opt out. Automatic per-frame shadow update is banned.
- **STD-REN-13.** A shadow map MUST redraw only when a caster or the light changed. A static window shows zero shadow redraws.
- **STD-REN-14.** Moving shadow casters MUST NOT be throttled on the reference preset.
- **STD-REN-17.** **Caches are keyed on complete inputs and fall back at identical quality.** A render cache MUST key on every input that affects its output. Anything unknown is treated as changing. A failed path renders the conventional full path. [ADR 0037]
- **STD-REN-38.** **Change detection observes; it never guesses.** Change trackers MUST observe every supported render dependency before deciding to skip a frame. Unknown dependencies force an update. [ADR 0056; ADR 0057]

### 9.4 Effects and static art

- **STD-REN-24.** Every effect MUST have a reference implementation first, a cost per preset, registered knobs and a quality guard.
- **STD-REN-27.** Hand-tuned looks MUST migrate verbatim. A look change is a separate, reviewed step.
- **STD-REN-28.** Static art MUST be reduced by the shared batching system, within semantic groups that can be hidden separately. [ADR 0055]

### 9.5 Assets and resources

- **STD-REN-30.** Every asset MUST have a definition in its owner's folder: id, kind, licence, author, source, colour space and variants. A shipped file without a definition, or a definition without a licence, fails the build. [ADR 0023]
- **STD-REN-31.** Code MUST address assets by id through the asset library, with its on-screen size and owner signal, never by path. [ADR 0023]
- **STD-REN-32.** Variants MUST be chosen by on-screen size at the reference resolution, capped by a knob. A live lease is never downgraded.
- **STD-REN-35.** Painted (canvas) surfaces MUST declare their size. They repaint only when visible, and their resident memory stays under the preset's budget.

---

## 10. The frame and concurrency

### 10.1 The frame loop

- **STD-RUN-1.** One frame loop MUST be the only frame scheduler in the app. [ADR 0032]
- **STD-RUN-2.** Tickers are either on-demand (render after invalidation) or continuous. When no ticker wants a frame, no frame is scheduled. [ADR 0015; ADR 0032]
- **STD-RUN-3.** Activity ticker coverage comes from the layer stack:
  - the top layer runs;
  - under a scrim, a ticker follows its declared coverage behaviour;
  - under an opaque layer, it never runs;
  - a resumed ticker receives zero elapsed time;
  - hidden tabs stop all loops.

  Application-scoped input sampling may use an explicitly declared update-only
  ticker on that same loop. It MUST NOT render, run in hidden tabs, or keep polling
  after its device/focus/lifetime is inactive. It does not exempt scene simulation
  or rendering from coverage. [ADR 0032; ADR 0074]
- **STD-RUN-4.** The frame carries elapsed time, game time, Calm, preset and coverage, and no kit nouns.
- **STD-RUN-5.** The loop is the only holder of the clock driver. It feeds the quality system every sample.
- **STD-RUN-9.** A still image produces zero rendered frames. Real idle motion renders and is reported.

### 10.2 Workers

- **STD-RUN-35.** The workers system MUST be the only code that creates threads. It hosts one pool of generic workers that load registered job modules on demand, and it knows no game noun. [ADR 0059]
- **STD-RUN-36.** A job MUST be a pure function of its request. Every job takes the caller's lifetime signal. Supersession keys are scoped to the owner and the job kind. [ADR 0059; ADR 0062]
- **STD-RUN-37.** **The frame never waits.** No ticker awaits a worker result in the frame that needs it. Results are picked up by the next frame that finds them. [ADR 0059]
- **STD-RUN-38.** A worker that fails rejects its job with a named error. Each job kind declares its fallback. A fallback never fabricates a result or blocks the frame. [ADR 0059]
- **STD-RUN-39.** The pool is sized from the hardware's concurrency. It keeps a warm minimum, grows on demand and releases idle workers. [ADR 0059]
- **STD-RUN-40.** The worker host MUST bound queued requests, active work and reserved memory before it accepts large payloads. Saturation has an explicit outcome. [ADR 0062]
- **STD-RUN-41.** Cancellation MUST distinguish rejecting delivery from stopping execution. [ADR 0062]

---

## 11. Input, UI shell and accessibility

- **STD-RUN-20.** The layer manager MUST own the top of the screen. There are five layer kinds, ranked `scene < panel < sheet < modal < toast`. The manager handles inertness, focus trapping and Back. [ADR 0020]
- **STD-RUN-22.** Narration and music MUST follow the top layer through events. [ADR 0020]
- **STD-RUN-23.** Shell buttons MUST be rows. Nothing else touches the shell DOM. [ADR 0020]
- **STD-RUN-24.** Styles MUST use a fixed cascade-layer order: reset, tokens, shell, primitives, features, overrides. Feature styles are scoped to their root, use only design tokens and never force precedence.
- **STD-RUN-25.** Every control MUST be an input action row. Keys, pad and pointer resolve to actions; the keymap never calls handlers. [ADR 0044]
- **STD-RUN-26.** One capture listener resolves keys in a fixed order. Typing in a text field is protected.
- **STD-RUN-27.** A press MUST be dispatched once, to one owner, with its owner epoch. On a route or player change, pause, focus loss, disconnect or remap, held state is cancelled and a neutral input is required. [ADR 0047]
- **STD-RUN-29.** Remapping edits bindings stored in settings. Help text and glyphs are generated from the effective bindings. [ADR 0044]
- **STD-RUN-30.** Every action MUST be reachable on every device, through a direct binding or a declared, verified focus path. [ADR 0044; ADR 0047]
- **STD-RUN-31.** The input reachability check MUST pass.
- **STD-RUN-32.** Calm and reduced motion MUST be honoured by every motion system, effect and transition.
- **STD-RUN-33.** A change to framing, labels, controls or camera MUST carry interaction evidence and inspected captures for each affected supported device profile, using the real camera. A narrow screenshot alone is insufficient. [ADR 0068]
- **STD-RUN-42.** Layout, input capabilities and graphics quality MUST be separate configuration dimensions. A small viewport MUST NOT imply a weak GPU, and touch MUST NOT imply a phone layout. Resolve them through existing settings/input/shell owners, not per-feature device detection. [ADR 0068]
- **STD-RUN-43.** Every advertised phone, tablet, laptop and desktop experience MUST satisfy [DEVICE-EXPERIENCE.md](policy/DEVICE-EXPERIENCE.md). Within a shared experience, profiles share action identities and required content while defining their own information density, panel behavior and control presentation. Only author-selected supported combinations require acceptance; distinct editions follow DX-0. [ADR 0069]
- **STD-RUN-44.** Active-play UI MUST preserve a declared usable world region and keep task-critical subjects visible and actionable. Shell chrome, persistent text and touch controls count toward obstruction. Readable buttons do not compensate for an obscured world.
- **STD-RUN-45.** Secondary information MUST use deliberate disclosure appropriate to available space. Reading/modal states MUST define input ownership, dismissal, focus restoration and simulation policy. No necessary action may become inaccessible through disclosure.
- **STD-RUN-46.** Resizing, rotation, browser chrome, safe areas, virtual keyboards, text scaling and input-device changes MUST preserve state and usable controls. Capability changes MUST NOT unexpectedly rearrange a control during an active gesture.
- **STD-RUN-47.** Touch interaction MUST support the simultaneous actions required by its core loop, use independent pointer ownership, and cancel safely on focus, route or pointer loss. Continuous controls MUST NOT trigger text selection or browser gestures; surrounding reading UI retains appropriate scrolling and accessibility.
- **STD-RUN-48.** Every device acceptance record MUST identify active-play, reading, interruption and recovery states. Unverified states or profiles MUST be marked unverified, never inferred from desktop or another device's results.

---

## 12. Strings

- **STD-STR-1.** All user-facing text MUST be a typed key lookup that requires exactly the key's variables. New literal UI text fails lint. [ADR 0021]
- **STD-STR-2.** Strings MUST be shards in the owning folder, merged into generated catalogues and key types. [ADR 0043]
- **STD-STR-3.** Reading levels are key variants (`standard` and `@detailed`). Plurals and ordinals use the platform's plural rules (`plural`, `selectordinal`); variants use `select`. [ADR 0021]
- **STD-STR-4.** A missing string falls back per key along the locale chain (explicit fallbacks, then truncated tags), ending at the base locale. Unknown keys fail in development, and in production they log once.
- **STD-STR-5.** Keys composed at runtime MUST be declared as families, and validation expands every family.

---

## 13. Performance budgets as contracts

### 13.1 Budgets

- **STD-PRF-1.** Every scene MUST declare one **scene budget**. It holds reference values, per-preset overrides once that port is built (falling back upward), and provenance. [ADR 0025; ADR 0030]
- **STD-PRF-2.** Budgets MUST cover:
  - draws, triangles and shadow work;
  - idle rendering;
  - texture, canvas and heap memory;
  - contexts;
  - frame time at the reference resolution;
  - load time and bytes;
  - chunk size.
- **STD-PRF-3.** A starting budget MUST be a measured value plus headroom, with provenance naming the commit, the harness and the run. [ADR 0030]
- **STD-PRF-4.** Targets are separate from budgets. A budget is lowered in the change that earns it: the ratchet. [ADR 0030]
- **STD-PRF-5.** Raising a budget MUST carry a reviewed, machine-readable commit trailer, `Perf-Budget: <key> <old> -> <new>: <reason>`. The budget ratchet enforces it. [ADR 0030]
- **STD-PRF-6.** Lighter-preset budgets MUST NOT be written before their port is built.
- **STD-PRF-8.** Recurring root causes MUST be removed by the system that owns them, never by per-scene workarounds.
- **STD-PRF-9.** Any change that adds an effect, post pass, painted surface or scene MUST state its cost per preset, reference first, and its quality guard.
- **STD-PRF-10.** Instrumentation MUST cost nothing in production.

### 13.2 Enforcement

- **STD-PRF-11.** The gate (`npm run gate`) MUST run on the rebased head before every integration merge, and its summary goes into the merge. It runs:
  - typecheck;
  - the lint ratchets (layers, owned capabilities, CSS, budgets);
  - the tests;
  - the bundle check;
  - a software-rendered bench at the reference preset.

  [ADR 0030]
- **STD-PRF-12.** The software-rendered gate MUST gate counts only. A count fails only when two consecutive runs breach it. Frame time is never gated in software rendering. [ADR 0030]
- **STD-PRF-13.** The deploy guard MUST run the bundle check and refuse to deploy on failure. It releases only a clean `main` equal to `origin/main`, under an exclusive release lock.
- **STD-PRF-14.** The **reference run** (the reference GPU at the reference resolution, headless and muted) gates frame time, load time, shadow redraws and idle render ratio, plus the quality guard.
- **STD-PRF-15.** Gates and benches MUST pin the preset and MUST NOT use detection or a governor. [ADR 0029]
- **STD-PRF-16.** The bench MUST enter scenes through their public routes, verify before every sample that the scene is still current, and record the harness, viewport and GPU.
- **STD-PRF-17.** Cached bench evidence MAY be reused only when the complete experiment matches: a conservative build digest plus the full experiment descriptor. The cache stores raw evidence, never a verdict. [ADR 0046]
- **STD-PRF-18.** Per-frame submission counters are reported, and become gated only after two consecutive benches agree. [ADR 0051]
- **STD-PRF-20.** Each advertised device profile MUST declare hardware/browser, viewport and pixel ratio, input, graphics preset, quality floor and performance acceptance thresholds. Minimum-device ceilings are scoped to the declared build, not all independent editions. They remain guardrails, not per-device certification. [ADR 0068]
- **STD-PRF-21.** Device acceptance MUST include cold/first-use and sustained representative interaction with normal UI and effects enabled. Software rendering and viewport emulation MUST NOT be represented as physical-device timing, thermal or memory evidence.
- **STD-PRF-22.** Automatic quality changes MUST preserve the declared quality floor, simulation and input semantics. UI target sizes, critical information and world visibility MUST NOT be sacrificed to meet rendering budgets.
- **STD-PRF-19.** A timing window MUST belong to one run epoch and route, and MUST be classified before comparison as entry, steady, first use, unclassified or invalid. Recurring work MUST NOT be turned off to satisfy a window. [ADR 0053]

---

## 14. Testing and the quality guard

- **STD-TST-1.** Every performance change MUST declare a quality guard and pass it at each declared view, with the preset pinned. There are three modes:
  - **identical**: no differing pixels. For scheduling-only changes.
  - **near**: at most 0.1 % of pixels beyond 2/255. For geometry and texture changes.
  - **reviewed**: a named person signs off the exact pair of pictures. For intentional look changes, which are never justified by performance alone.

  The tolerances are fixed in the guard. [ADR 0030]
- **STD-TST-2.** Where pixels are not the right proof, the guard MUST be a behaviour check.
- **STD-TST-4.** Verifiers MUST read simulation state through the typed test API (`window.engine`), not by scraping the DOM. UI geometry and accessibility checks follow STD-TST-16. [ADR 0026]
- **STD-TST-6.** Features expose state for tests through registered probes, read on demand.
- **STD-TST-7.** Serialised state MUST NOT be written into DOM attributes anywhere. [ADR 0026]
- **STD-TST-8.** Test browsers MUST be isolated and muted, and MUST NOT change the user's system or application audio. Audio evidence MAY render with `OfflineAudioContext`, which renders into memory and never reaches a device, inside the muted test browser; it MUST NOT create a real-time `AudioContext`.
- **STD-TST-9.** Content validation MUST run every registry's validation from the frozen boot, so a mistake names its row. New registries are covered without editing the test.
- **STD-TST-12.** Save changes pass the fixture chain, the export round-trip and the reset-prefix test.
- **STD-TST-13.** A cache, key or gate mechanism MUST be tested by mutation: a test deliberately omits an input and checks that it is caught. [ADR 0046]
- **STD-TST-14.** Handover and input ownership are tested for a stale load, a stale enter, a player switch and a failed render. [ADR 0045; ADR 0047]

- **STD-TST-15.** Device-profile verification MUST cover the matrix and interaction scenarios in [DEVICE-EXPERIENCE.md](policy/DEVICE-EXPERIENCE.md). Automated smoke results and manual usability/performance evidence MUST be reported separately.
- **STD-TST-16.** UI geometry, hit testing and accessibility semantics MAY be inspected through browser APIs; simulation assertions continue to use registered probes/the typed test API. Neither kind of evidence substitutes for the other.
- **STD-TST-17.** Device layout comparisons MUST use the same profile, state and quality settings. Intentional cross-profile layout differences are not pixel regressions; within-profile quality tolerances MUST NOT be weakened.

---

## 15. Change control

### 15.1 Decisions

- **STD-GOV-1.** Every decision that shapes structure, data formats or budgets MUST be a numbered ADR, with status Proposed, Accepted, Superseded or Rejected. [ADR 0001]
- **STD-GOV-2.** ADRs are never rewritten. A change of decision is a new ADR that supersedes or amends the old one. [ADR 0001]
- **STD-GOV-3.** A review MUST reject a change that contradicts an ADR this standard cites, unless the change comes with a superseding ADR.

### 15.2 Execution

- **STD-GOV-10.** Each change ships alone: the game builds, saves load, and the change reverts by itself.
- **STD-GOV-11.** Implementation work follows the repository's worktree and release rules ([AGENTS.md](../AGENTS.md)):
  - one isolated worktree per task;
  - serial integration;
  - the gate before every integration merge;
  - production deploys only through the guarded release, from a clean, synchronised `main`.
- **STD-GOV-18.** Ownership and authorship are outside the architecture: no clause, budget or type depends on who, or which model, writes the code. [ADR 0061]
- **STD-GOV-19.** Adopting a shared system MUST NOT remove anything a player can do today.

### 15.3 Changing this standard

- **STD-GOV-13.** This standard is revised by pull request. A revision that changes a rule MUST cite the ADR that decides it.
- **STD-GOV-14.** Clause IDs MUST NOT be renumbered or reused.
- **STD-GOV-15.** The ADR that answers a Provisional clause's question confirms or amends the clause, which then loses its marker.
- **STD-GOV-16.** An ADR accepted after this standard's revision date governs over a conflicting clause until the standard is amended.
- **STD-GOV-20.** **The Standard and its application.** This standard states systems, contracts and invariants, and never names a specific scene or game object. APPLICATION.md holds the specifics, each linked to the clause it applies.

---

## 16. Conformance

### 16.1 Units of conformance

- **STD-CNF-1.** **A file conforms** when all of these hold:
  - it sits in the right layer and depends only downward;
  - it uses no owned capability outside its owner (STD-LAY-10);
  - it contains no literal UI text (STD-STR-1);
  - it owns everything it creates (STD-MOD-5, STD-RUN-7).
- **STD-CNF-2.** **A feature conforms** when, in addition, all of these hold:
  - it is one folder with an eager manifest and a lazy body;
  - its rows validate;
  - its scene declares a measured budget;
  - its controls are reachable on every device;
  - its saved state is registered sections with migrations;
  - adding it touched nothing outside its folder.
- **STD-CNF-3.** **A pack conforms** when it has the feature anatomy, changes existing content only by reported patches, holds behaviour only as lazy rows, and disables itself cleanly when a dependency is missing.
- **STD-CNF-4.** **A scene conforms at the reference tier** when it passes the gate, the reference run within its budget, and the quality guard for every change since its baseline.
- **STD-CNF-5.** **A change conforms** when all of these hold:
  - it passes the gate on the rebased head;
  - it keeps every ratchet at or below its baseline;
  - it carries a budget trailer for any raise;
  - it carries its quality guard.

### 16.2 Checks

- **STD-CNF-6.** Each system is enforced by the checks below.

| Area | Enforcing checks | Where |
|---|---|---|
| Layers | Import direction, cycles, manifest closure; owned-capability ratchet with sharded baselines | `scripts/lint/layers.mjs`, `scripts/lint/architecture.mjs`, `scripts/lint/manifests.mjs` |
| Module kernel and registries | Registries test from the frozen boot; discovery test; availability tests | `src/app/registries.test.ts`, `src/core/*.test.ts` |
| Save store | Fixture chain, export round-trip, reset prefix, quarantine | `src/core/save/*.test.ts` |
| Styles | Cascade layers, root scope, tokens, no `!important` | `scripts/lint/css.mjs` |
| Strings | Literal-text ratchet; key generation | `scripts/lint/architecture.mjs`, `scripts/strings.mjs` |
| Performance | Gate count budgets and regressions; bundle check; budget ratchet | `scripts/perf/gate.mjs`, `scripts/perf/budget-ratchet.mjs` |
| Pictures | Quality guard | `scripts/perf/quality-guard.mjs` |
| Release | Deploy guard with release lock | `scripts/deploy-production.mjs` |

### 16.3 Transitional conformance

- **STD-CNF-7.** New files, folders and packs MUST conform fully from the day they are added, and MUST NOT be added to any baseline.
- **STD-CNF-8.** Existing code that has not yet been migrated is recorded in the ratchet baselines, and it MUST NOT grow any counted violation.
- **STD-CNF-10.** The only permitted exceptions are:
  - falling ratchet baselines;
  - reviewed budget trailers;
  - signed-off `reviewed` guards;
  - accessibility exceptions with a reason.

  Any other exception requires an ADR.
- **STD-CNF-11.** A conformance claim MUST name its evidence: the gate summary, the reference run and the quality-guard result. "It looks fine" is not evidence.
