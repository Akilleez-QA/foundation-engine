- **The Foundation stdio bridge is self-contained.** `tools/foundation_engine_bridge.py` computes both read-only tool
  results itself and no longer starts `node --import tsx`; it needs only Python 3 and `schemas/read-only-tools.json`.
  `scripts/foundation-bridge-call.ts` is removed. Tests check that results equal the TypeScript validators.
