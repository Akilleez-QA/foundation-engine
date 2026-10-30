// Generates the courtyard fixture's lookup table for the post grade browser check into ../public/luts (not committed:
// `npm run test:post-browser` runs this first). An inverting table, so the check can tell at a glance that it applied.
// Run: npx tsx tools/visual-courtyard/game/tools/make-luts.ts
import {mkdirSync, writeFileSync} from 'node:fs';
import {cubeLutText} from '@engine';

const dir = new URL('../public/luts/', import.meta.url);
mkdirSync(dir, {recursive: true});
writeFileSync(
  new URL('invert.cube', dir),
  cubeLutText((r, g, b) => [1 - r, 1 - g, 1 - b], {title: 'invert'}),
);
