# <Title>

<!-- The brief (game/build.brief.ts) is the contract; this block mirrors it. Change the brief first, then this block,
     then add a changelog row. Budgets are re-derived from the brief and only fall without a Perf-Budget trailer. -->

## Brief

| | |
|---|---|
| **Goal** | <one sentence, exactly as in the brief> |
| **Pitch** | <one or two sentences> |
| **Audience** | <ages, `kids: true/false`>; policy `<default / kid-safe>` |
| **Genre** | <template name or your own> |
| **Core loop** | <step → step → step> |
| **Devices** | targets <…>; minimum **<device>**; input <keyboard, pointer, touch, gamepad> |
| **Performance** | <fps>; per scene at most <draws> draws, <triangles> triangles (<minimum> tier); first-load JS ≤ <KiB> |
| **Modes** | <play, …> |
| **Constraints** | <content and IP rules> |

### Success criteria

| Id | Check | How |
|---|---|---|
| S1 | <what is observed, where, and the pass condition> | <test: `game/<file>.test.ts` / playtest: `playtest/<file>.json` / gate / manual> |

## Device experience acceptance

Choose supported devices, modes and distribution strategy first; unsupported
targets impose no constraints on this build. Record deliberate shared-platform
tradeoffs or separate-edition quality/content differences. Then complete the
device matrix in APPLICATION.md using
[the device experience policy](../policy/DEVICE-EXPERIENCE.md). For each advertised
phone, tablet, laptop and desktop profile, define active/reading/interruption
layouts, world visibility, input paths, quality floor and measured performance
thresholds. Link evidence for portrait/landscape, resizing, text scaling and relevant
hybrid inputs. Mark every untested combination unverified; one desktop or phone
smoke does not establish another profile's acceptance.

## What is in it

| File | What |
|---|---|
| `game/game.ts` | `defineGame`: id, first scene, kits, strings |

## Milestones

1. **Vertical slice**: <the core loop, end to end, in one scene>.
2. <next>

## Changelog

| Date | Change | Budgets |
|---|---|---|
| <yyyy-mm-dd> | Started from the <template> template | |
