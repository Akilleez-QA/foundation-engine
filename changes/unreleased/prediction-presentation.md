- **Optional prediction presentation** (`createPredictionSmoothing` and `createPredictedEvents` in `@kits/network`):
  bounded correction smoothing with a snap threshold and a one-shot discontinuity flag, and an exactly-once
  predicted-event ledger that cancels mispredictions once. Both compose with `createPrediction` without changing it.
  See [the guide](docs/guides/prediction-presentation.md) and [ADR 0142](docs/adr/0142-prediction-presentation.md).
