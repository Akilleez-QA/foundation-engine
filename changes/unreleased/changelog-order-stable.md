- **Stable order for uncommitted changelog fragments.** `npm run changelog` read the clock once per uncommitted
  fragment, so a second boundary between two reads could sort them newest first instead of by name. One reading is
  now shared by the whole listing. This removes an intermittent `changelog.test.mjs` failure.
