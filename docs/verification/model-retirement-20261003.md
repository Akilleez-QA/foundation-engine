# Model retirement after transport cancellation — 2026-10-03

The existing model-preview consumer now repeats three delayed candidate cancellation
and scene reentry cycles. Each new cancellation is correlated to the exact browser
request object, and ownership assertions run after that request finishes or fails.
Earlier HTTP failures or another request using the same URL cannot satisfy the wait.
The test changes no runtime behavior, budget or asset.

## Evidence

The existing `test:model-preview-browser` command passed on clean
`c750dd0d746e95858214bb3aae0453aa7f9f1faa`, based on public main `5a68f06`, at
2026-10-03T18:21:42Z. Script SHA-256:
`445fa58ff4991f16d310d2ca60a0e6820b278f1c451f6447aae738aa2735e253`.
This receipt is a documentation-only follow-up.

Run with Node 22.23.3, isolated muted Chromium, desktop 1440×960 and software GL,
at niceness 15. No other local browser suite ran concurrently. The post-cycle
screenshot was inspected: the accepted model remains visible, candidate is absent,
and the consumer reports its saved selection. Local regenerable evidence is in
`playtest/model-preview/report.json`, `snapshots.json` and
`repeated-retirement.png`.

| Checkpoint | Observed ownership |
| --- | --- |
| Baseline | 1 model instance, 0.00091552734375 MiB resident, 0.002834320068359375 MiB retained file bytes, 0 cleanup failures |
| Each of three cancelled candidates | Exact request terminated with `net::ERR_ABORTED`; accepted identity unchanged, no candidate, 1 instance; resident and retained bytes do not exceed baseline |
| Each following scene reentry | New scene epoch, saved accepted selection restored, no candidate, 1 instance; resident and retained bytes remain bounded; 0 cleanup failures |
| Application disposal with another request pending | Exact request terminated with `net::ERR_ABORTED`; retired consumer and 0 entities, model instances, resident bytes, retained file bytes and pinned bytes; 0 cleanup failures |

The existing unavailable-asset cases retain their four expected error reports;
the error verdict runs after browser and server cleanup. No additional page errors
or scenario/cleanup failures were observed.

## Validation and boundary

```sh
npm run test:model-preview-browser
node --import tsx --test src/platform/assets/models.test.ts src/author/scene-model.test.ts scripts/play/diagnostic-report.test.mjs
node scripts/lint/genericity.mjs
```

Use Node 22.23.3 for these commands. The focused run passed **47 tests**, including
cancelled decoder admission held until actual settlement and late scene-lease
release. Final script syntax, documentation genericity and diff checks passed.
The existing CI command already includes this consumer.

This browser evidence covers **transport cancellation**: the delayed requests abort
before their response is supplied. It does not prove decoded work completing after
cancellation; the named unit tests remain separate evidence for that path. Model
statistics are ownership estimates and counts, not measured driver memory or a
complete heap/listener audit. A document-owned renderer pool may retain its context
after application disposal; this test neither requires nor claims zero document
contexts. No physical-device or full local integration gate acceptance is claimed.
