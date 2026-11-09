# Foundation Engine documentation

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      DOCS: SELECT A ROUTE
 [############]
```

Foundation Engine is a TypeScript engine for 3D browser games on three.js. Pick the line that matches what you want
to do now. New here? Read the [project README](../README.md), then [getting started](guides/getting-started.md).

## Learn: your first game

- [Getting started](guides/getting-started.md): from a clone to a game you can share, step by step, by hand or with a
  coding agent.
- [Working with your agent](guides/working-with-your-agent.md): how to direct a coding agent that builds your game.
- [Labs](guides/labs.md): prove one system (a mechanic, a kit, a technique) in a small separate game before you build a
  world on it, then move it into the engine.

## Do: recipes for one task

- [Cookbook](recipes/README.md): one recipe per task: models, HUD and buttons, collision and picking, camera, saves,
  budgets, playtest scripts and sharing a build.
- [Make it look good](recipes/art-direction.md): palette, light presets, sky and haze, low-poly forms, baked light.
- [Scene look](guides/scene-look.md): tone mapping, exposure, point and spot lights, shadows and a gradient sky, as
  plain data.
- [Blob shadows](guides/blob-shadows.md): soft ground shadows under entities where no shadow map reaches, in one draw.
- [Game brief template](guides/GAME.template.md): the `GAME.md` brief that `npm run lint:brief` checks.

## Look up: reference

- [Capabilities](capabilities.md): every shipped feature, kit, setting, template and script, generated from the code
  ([JSON](capabilities.json)). When another page disagrees with this list, the list is right.
- [Kit catalog](kits/README.md): the optional building blocks a game can pick, configure or leave out.
- [Data dictionary](data/data-dictionary.md): tool fields, environment variables, options, data files and limits.
- [Changelog](../CHANGELOG.md): what changed in each release.

## Understand: how and why it is built this way

- [Design description](architecture/architecture.md): components, data flow, the frame loop and timing.
- [Architecture standard](STANDARD.md) and [creator contract](CREATOR-CONTRACT.md): the rules, and what the game author
  decides versus what the engine decides.
- [Decisions](adr/README.md): one record per design choice, with its reasoning.
- [Character pipeline lessons](guides/character-pipeline-lessons.md) and
  [crowd and night rendering lessons](guides/crowd-and-night-rendering-lessons.md): what a character-crowd lab taught
  (retargeting, weights, LOD, clip checks, crowd cost, wet looks), and what the engine does and does not provide.
- [Provenance](PROVENANCE.md): where this engine came from.

## Status and limits

- [Limitations](guides/limitations.md): what the engine does not do.
- [Goals](GOALS.md) and [roadmap](ROADMAP.md): what the project aims for and what may come next.
- [Device experience policy](policy/DEVICE-EXPERIENCE.md): phone, tablet, laptop and desktop are accepted separately.
- [Capability map](guides/composition-framework-status.md), [framework record](guides/framework-upgrade-status.md) and
  [acceptance ledger](guides/upgrade-acceptance-ledger.md): what is implemented, checked and integrated, and what is
  not yet verified.
- [Release candidate `7c26db7`](releases/candidate-7c26db7/README.md): proposed 0.3.0 notes, upgrade guide, support
  matrix and evidence; prepared, not released. [Release notes draft for 0.2.0](guides/release-notes-0.2.0.md).

## Contribute to the engine

- [CONTRIBUTING.md](../CONTRIBUTING.md): set up, propose, check and submit a focused change.
- [Brand](brand.md): logo, palette, ASCII banners and asset licence.

## Specialist guides

- [Predeclared acceptance evidence](guides/acceptance-evidence.md), [dimensional inventory candidates](guides/dimensional-inventory.md), [industrial state candidates](guides/industrial-candidates.md), [ordered industrial transfer batches](guides/industry-transfer-batches.md) and [progression inspection](guides/progression-inspection.md).
- [Optional pure kit package](guides/pure-package.md): kits shipped without the engine runtime or three.js.
- Evidence records: [cellular WASM](verification/cellular-wasm/README.md), [indexed geometry](verification/indexed-geometry/README.md) and [lazy scene bodies](verification/lazy-scene-bodies-2026-09-30.md).

## Engineering records

Organized after the NASA software documentation guidance (NPR 7150.2D, NASA-STD-8739.8B,
SWEHB 7.18). Software classification: a self-assessed analog of NPR 7150.2D Class E
(general-purpose research software), not safety-critical. This is not a NASA compliance
determination. Each document carries a metadata header with its baseline commit;
`npm run lint:trace` checks the headers, the requirement trace and every relative link.

| Document | ID | Purpose |
|---|---|---|
| [Software management plan](plan/software-management-plan.md) | FENGINE-SMP | Classification, life cycle, assurance, security, maintenance, risks |
| [Requirements mapping matrix](plan/compliance-matrix.md) | FENGINE-RMM | How each NPR requirement applies, is tailored or is not applicable |
| [Requirements specification](requirements/requirements.md) | FENGINE-SRS | What the engine and its tooling shall do, plus untested gaps |
| [Design description](architecture/architecture.md) | FENGINE-SDD | Components, data flow, concurrency, decisions, quality attributes |
| [Interface control](icd/icd-dependencies.md) | FENGINE-ICD-dependencies | Dependencies, consumers and the read-only stdio bridge |
| [Data dictionary](data/data-dictionary.md) | FENGINE-DD | Tool fields, environment variables, options, data files, limits |
| [Test plan and procedures](verification/test-plan.md) | FENGINE-STP | Test levels, environment, CI commands, pass criteria, procedures |
| [Verification matrix](verification/verification-matrix.md) | FENGINE-VM | Requirement to test to result |
| [Test reports](verification/reports/README.md) | FENGINE-STR-* | Generated results per baseline or tag |
| [Configuration management](configuration/configuration-management.md) | FENGINE-SCMP | Configuration items, baselines, digests, generated outputs, releases |
| [Releases and version descriptions](releases/README.md) | FENGINE-VDD-* | What each tag contains and how to rebuild it |
| [Assurance record](assurance/assurance-record.md) | FENGINE-SAR | Analyses, audits, scans and review summaries per baseline |
| [User manual map](guides/SUM-MAP.md) | FENGINE-SUM-MAP | Where each user-manual element lives |
| [Limitations and safety-relevant use](guides/limitations.md) | none | What the engine does not do |

Dated verification records stay under [verification/](verification/verification-matrix.md#4-earlier-evidence-historical)
and are not rewritten.
