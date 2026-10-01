# ADR 0069: author-selected device and edition scope

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Product scope, quality and verification
- **Amends:** ADR 0068; clarifies ADR 0017 and ADR 0029 within a declared experience.

## Decision

An author chooses the supported device/mode combinations and their quality floors.
Single-target maximum-quality releases, tablet-first or phone-first releases,
shared cross-platform releases and distinct device editions are all valid.
Unsupported devices impose no design or performance ceiling on supported editions.

Within a shared experience, graphics presets preserve required content and rules.
Separately declared editions may differ in mode/content scope and quality. These
choices must be explicit to the author and player; a runtime governor cannot
silently remove promised functionality. Persisted data for unavailable features
is preserved, and compatible-save claims require migration/reload evidence.

Existing brief minimum-device ceilings apply to their own build. A shared artifact
accepts its declared aggregate costs; independent artifacts may have independent
briefs and budgets. This does not add a multi-edition compiler or distribution
service, raise a budget, or change a current application's support promises.

## Acceptance

The application records its selected scope and tradeoffs before device acceptance.
Only supported combinations require the full device policy. Experimental and
unsupported combinations are labelled; absent evidence never becomes a passing
support claim. Review must reject forcing mobile compromises into a desktop-only
brief or dropping promised mobile support without an explicit scope decision.
