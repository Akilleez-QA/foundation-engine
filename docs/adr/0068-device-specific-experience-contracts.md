# ADR 0068: device-specific experience contracts

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Input, UI, quality and verification
- **Amends:** ADR 0029's reference-only acceptance and later-port interpretation; ADR 0030's two harnesses remain required but do not certify every device experience.

## Context

A desktop HUD can pass type, budget and screenshot checks while covering most of a
phone's playable world. Tablets require touch and hybrid-input behavior even when
viewport width resembles a laptop. A minimum-device performance ceiling says
nothing about readable information density, unobstructed tasks or sustained device
performance. Reference-quality graphics must not become desktop-only interaction.

## Decision

Treat layout, input capabilities and graphics quality as independent dimensions
resolved by the existing shell/input/settings owners. Applications declare separate
phone, tablet, laptop and desktop acceptance profiles for every advertised target.
Use the normative [device experience policy](../policy/DEVICE-EXPERIENCE.md) and
record profile evidence in APPLICATION.md. Required content and actions remain
available; simultaneous presentation and secondary disclosure may differ.

Preserve the active world and task-critical subjects before adding persistent UI.
Count shell chrome, text, transparent hit interception and touch controls in the
visibility review. Expanded reading has an explicit interaction/simulation state;
it cannot silently make ongoing play unusable. Input and orientation changes preserve
state and release obsolete held controls.

Keep existing count/bundle/performance caps and visual tolerances. Add per-device
quality and sustained performance acceptance; do not treat a reference-preset
software bench or emulated phone screenshot as physical-device certification.

## Enforcement and transition

The policy adds review and release requirements now. Existing scripts still supply
only their documented checks; no occlusion analyzer, complete tablet matrix, thermal
harness or device-profile validator is claimed by this documentation change.
Unverified existing profiles are recorded as gaps. A runtime/UI change must include
manual evidence for affected profiles until matching automation exists. This
standards-only change does not certify current templates or redesign their UI.

New runtime configuration and automated checks require their own typed contracts,
regression tests and bounded consumers. Reuse current action rows, layer stack,
settings and test harnesses rather than introduce parallel UI ownership.
