# Recipe: write plurals, ordinals and variants in strings

All player-facing text is a string key (`defineGame({ strings })`, `ctx.text(key, vars)`). A message may
use `{name}` holes and three ICU MessageFormat arguments. The key types are generated from the `en` text, so
`ctx.text` requires exactly the variables a message uses.

## Plural (cardinal): counts

```json
{ "shop.tokens": "You have {n, plural, =0 {no tokens} one {# token} other {# tokens}}." }
```

Forms are `=N` (exact), then the locale's CLDR category (`zero`, `one`, `two`, `few`, `many`, `other`), then
`other`. `#` is the number formatted for the locale. `n` must be a number.

## Selectordinal: positions

```json
{ "race.rank": "You finished {rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}." }
```

Same forms as plural, chosen by the locale's ordinal rules (`1st`, `2nd`, `3rd`, `11th`, `21st`, `112th` in
English). Other languages use their own categories; write the forms their rules need.

## Select: variants

```json
{ "talk.left": "{who, select, she {She left} he {He left} other {They left}}." }
```

Cases are identifiers matched against the value's text; anything else, or no value, uses `other`. Arguments
nest: `{who, select, she {She has {n, plural, one {# map} other {# maps}}} other {They have # maps}}`.

## Rules the checker enforces

- Every plural, selectordinal and select needs an `other` form; unknown plural categories and duplicate
  cases are errors at `npm run check` (string generation).
- No literal braces: a message with `{` or `}` that is not an argument is rejected.
- A message is at most 16,384 characters, nests arguments at most 8 deep and has at most 1,024 parts.

## Locales and fallback

Catalogues are per locale: `defineGame({ strings: { en: {...}, 'pt-BR': {...}, pt: {...} } })`. A key missing
in the current locale is looked up along a chain: explicit fallbacks, then the tag shortened one subtag at a
time (`pt-BR` → `pt`), then the base locale `en`. The chosen locale's plural rules apply to the text it
supplied. The running game currently starts and stays in `en`; selecting another locale at run time is not yet
an author API (the core `createI18n({ locale, fallbacks })` and `setLocale` support it).

## Test it

`testScene` renders `ctx.text` with the same parser in `en`, so a game test can check each form:
`assert.equal(t.ctx.text('race.rank', { rank: 22 }), 'You finished 22nd.')`. Engine tests cover other
locales and the fallback chain in `src/core/i18n/select-ordinal.test.ts`.
