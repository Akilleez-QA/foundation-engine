# Interaction alignment experiment

Question: can two different creator interactions share bounded local-frame alignment proposals and a prepare/acknowledge lifetime without transferring movement, input, physics, or inventory ownership?

This headless experiment now consumes the optional public `@kits/alignment` helper; the duplicate tool implementation was removed. `alignment.test.ts` contains two creator fixtures: console activation and socket placement. Both apply proposals with a deliberately small test-only pose owner. They are not runtime movement implementations. No external implementation was copied.

Run from the repository root:

```sh
node --import tsx --test tools/interaction-alignment-lab/alignment.test.ts
node_modules/.bin/tsc --noEmit -p tools/interaction-alignment-lab/tsconfig.json
```

See the [contract and evidence guide](../../docs/guides/interaction-alignment-lab.md). Status: public kit candidate with focused headless checks; not integrated, playable, or device-accepted. No full repository gate or browser evidence is claimed.
