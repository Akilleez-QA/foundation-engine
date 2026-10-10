# ADR 0098: data-defined stat and damage formulas

- **Status:** Proposed (candidate implementation)
- **Date:** 2026-10-09
- **Area:** Optional kits / Rules

## Context

Combat's `resolveAction` deliberately leaves mitigation to the application, and the capabilities kit derives stat
values from source-owned additions and multipliers. Games still rewrite the same arithmetic by hand: a damage
expression, a critical roll, the order in which flat bonuses, strongest-only buffs, capped additive bonuses and
resistances apply, rounding and floors. Hand-written arithmetic hides its order, draws randomness inconsistently and
cannot be tuned as data. The creator asked for formula libraries as optional, configurable starting points,
including faithful presets of published games' arithmetic.

## Decision

Add an optional `formulas` kit with no systems: JSON expressions (with a text form that compiles to the same
data), ordered formula sheets validated at definition time, declared stacking stages (`add`/`multiply` with
`sum`/`max`/`min`/`product` combine rules and per-stage bounds) and a damage model whose resolution order is fixed
and documented (sheet, miss, stacking, resistance/immunity, rounding, minimum/maximum). Evaluation uses only
correctly rounded arithmetic, `Math.sqrt` and the existing deterministic `dmath`; randomness comes only from a
caller-supplied source such as `ctx.random`. There are no loops or side effects in the language, so one evaluation's
work is bounded by its node count, and its draws by `maxDraws`.

The kit owns validation, order and bounds. The creator owns every rule, constant, table and the decision of what an
amount means. Stat sources stay with the capabilities kit; consequences stay with combat or the game. Presets are
copyable data: generic archetypes plus a named transcription of one game's documented arithmetic, tested against an
independent transliteration.

## Consequences and evidence

Creators can tune or replace formulas without code changes and can trace every step and stage. Integer-style
rules use explicit `floor`/`trunc`/`//`; there is no fixed-point type (32-bit overflow of original hardware is not
modelled). Failing evaluations throw after any draws they took; callers that must retry without advancing the stream
save its state first. A recursive evaluator is intended for per-action resolution, not hot per-entity loops.
Focused tests cover parsing/precedence, refusal of malformed data and undefined arithmetic, sheet ordering, seeded and
restored-stream reproducibility, stacking order independence, the damage pipeline and a 2,000-case preset
transcription check. No browser, game integration or device acceptance is claimed.
