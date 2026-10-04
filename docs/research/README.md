# Implementation studies

These notes inspect external implementations to inform Foundation Engine decisions.
They are proposals and evidence, not adopted dependencies or completion claims.
Source code and assets are not copied into this repository.

- [Audio preparation and lifetime](JUCE-AUDIO-LIFETIME.md)
- [Editor document and component architecture](JUCE-EDITOR-ARCHITECTURE.md)
- [Terrain, navigation, animation and diagnostics](TOOLING-LANDSCAPE.md)
- [Open-source tooling priorities](OPEN-SOURCE-TOOLING.md)
- [Game UI/UX research and implementation priorities](GAME-UI-UX.md)

## Research coverage

The tooling research lane spans the full engine and authoring pipeline: terrain and
geometry, animation, physics and navigation, rendering and asset inspection,
profiling and debugging, deterministic testing and replay, content compilation,
editor workflows, input/accessibility, audio and packaging. No example framework
sets the boundary of this work. Coverage is driven by inspected engine gaps and
actual consumer needs, not by a list of fashionable dependencies.

A study may deeply inspect one mechanism, but its recommendations must be compared
with needs across the engine before becoming the next implementation priority.
Build, reuse and defer are all valid outcomes. Keep source-specific observations
in research notes and expose independently designed generic contracts in runtime APIs.

## Evaluation bar

Every proposed mechanism must identify its existing engine owner, a bounded consumer,
and a measurable acceptance test before implementation. Preserve the current quality
floor and performance caps. Account for cancellation, late results, overload, cleanup,
error reporting and repeated use, not only successful initial construction.

Extensibility means a new consumer can use a stable contract without editing unrelated
systems. Maintainability means ownership and failure behavior are explicit, tests
exercise observable outcomes, and there is one implementation path to understand.
A mechanism that adds a second scheduler, cache, registry or state owner must explain
why the existing one cannot serve it.

Research should revisit actual pinned source as implementation exposes new questions.
Separate observed behavior from recommendations, and record weaknesses as well as
useful patterns. Native threading, device APIs and licensing metadata do not transfer
automatically to a browser engine. New dependencies need a separate adoption decision.

- [Callback ownership and bounded diagnostics](CALLBACK-OWNERSHIP.md)
- [Runtime pose chains: interpolating key poses at runtime (recommendation: not now)](runtime-pose-chains.md)
