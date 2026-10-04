# Lantern Courtyard (fixture)

## Brief

| Field | Value |
| --- | --- |
| Goal | Show the visual-capability trial courtyard drawn with the author API and with the @kits/three escape hatch. |
| Pitch | A night courtyard of lanterns: painted light pools before, real point lights, shadows and bloom after. |
| Genre | explorer |
| Core loop | walk around the courtyard → collect the embers → compare the lantern light |
| Devices | desktop minimum and target; keyboard and pointer |
| Performance | Declared desktop caps for a browser check, measured in software GL; not physical-device acceptance. |

## Success criteria

| Id | Check | How |
| --- | --- | --- |
| S1 | The kit draws custom-object lanterns with point lights, shadows and bloom, counts their draws and disposes everything on exit. | playtest: `browser.mjs` |

## Changelog

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-10-03 | Fixture ported from the visual-capability trial; the lit courtyard and the still lantern scene use @kits/three. | `npm run test:three-kit-browser` (browser.mjs). No template budget changed. |
