# Shell-independent renderer startup

Controlled production builds compared base `4cdf844` with implementation `8f81bc8`,
both with `GAME_DIR=templates/expedition/game`, the same dependencies and Vite
configuration. The baseline used the original renderer pool and shell module;
the candidate used the lightweight singleton accessor. Other game and engine
sources were unchanged. Both builds emitted manifests; measurement follows each
HTML entry and its static imports, matching the bundle gate definition.

| Expedition static HTML-entry JavaScript | Bytes | KiB |
| --- | ---: | ---: |
| Baseline | 729,003 | 711.9 |
| Candidate | 242,094 | 236.4 |
| Reduction | 486,909 | 475.5 |

The entry reduction is 66.8%. Renderer implementation is deferred to actual render
consumers; it has not been deleted. A rendering scene still loads and uses it, with
synchronous leases, the same pool singleton, and unchanged quality and mechanics.
The total emitted JavaScript grows from 1,017,935 to 1,020,899 bytes (+2,964);
code splitting does not eliminate renderer cost. Expedition’s first rendered scene
still loads the runtime and its renderer dependency before requesting a synchronous
lease. Total network bytes fetched through first-scene readiness were not measured.
This measurement does not establish faster first rendered frames or physical-device
performance. Other games may import GPU code eagerly.

Focused renderer tests verify that shell settlement/probes leave the pool absent
until a render consumer initializes it, that both access paths share the same
owner, and that settlement preserves active leases while retiring parked contexts.
