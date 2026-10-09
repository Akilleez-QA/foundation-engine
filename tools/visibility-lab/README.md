# Visibility contribution lab

Question: can two creator policies share bounded overlapping contribution ownership without sharing geometry or authority?

`sensors.ts` distinguishes current, remembered and unknown map cells. `facilities.ts` admits service only from current provider coverage, ignoring retained exploration. Both import the optional public helper; product code never imports this lab. Footprints are explicit test data, not geometry implementations.

```sh
node --import tsx --test src/kits/visibility/*.test.ts tools/visibility-lab/*.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tools/visibility-lab/tsconfig.json
```

Focused headless evidence only. No browser, collision/occlusion, network disclosure, save migration, physical-device or sustained-performance acceptance. [Public contract](../../src/kits/visibility/README.md).
