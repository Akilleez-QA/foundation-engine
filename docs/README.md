# Foundation Engine documentation

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      DOCS: SELECT A ROUTE
 [############]
```

Start with one route; the rest is reference.

## Make a game

- [Getting started](guides/getting-started.md): from a clone to a static build you can share, by hand or with a coding agent.
- [Capabilities](capabilities.md): what this checkout ships, generated from the code ([JSON](capabilities.json)). When a page and this list disagree, the list is right.
- [Cookbook and building blocks](recipes/README.md): one recipe per task (models, HUD and buttons, collision, camera, saves, budgets).
- [Scene look](guides/scene-look.md): opt-in tone mapping, exposure, local point and spot lights, shadows, and a gradient sky with haze for a scene, as plain data.
- [Blob shadows](guides/blob-shadows.md): soft ground ellipses under entities where no shadow map reaches, all in one instanced draw.
- [Kit catalog](kits/README.md): optional patterns a game can choose, configure or leave out.
- [Labs](guides/labs.md): prove one system (a mechanic, a kit, a technique) in a small isolated game before building a world on it, then graduate it into the engine.
- [Character pipeline lessons](guides/character-pipeline-lessons.md) and [crowd and night rendering lessons](guides/crowd-and-night-rendering-lessons.md): practices learned in a character-crowd lab (retargeting, weights, LOD, clip QA, crowd cost, transitions, wet looks, measuring), with what the engine does and does not provide.
- [Working with your agent](guides/working-with-your-agent.md): the author's side of the operating manual.

## Contribute to the engine

- [CONTRIBUTING.md](../CONTRIBUTING.md): set up, propose, validate and submit a focused change.
- [Architecture standard](STANDARD.md) and [creator contract](CREATOR-CONTRACT.md): the rules and who decides what.
- [Decisions](adr/README.md): the reasoning behind the design.

## Status and limits

- [Goals](GOALS.md) and [roadmap](ROADMAP.md): defined outcomes and what may come.
- [Capabilities](capabilities.md): the generated list of shipped and not-yet-shipped features, kits, knobs, templates and scripts; the source of truth for what exists.
- [Capability map](guides/composition-framework-status.md), [framework record](guides/framework-upgrade-status.md) and [acceptance ledger](guides/upgrade-acceptance-ledger.md): what is implemented, checked and integrated, and what is still unverified.
- [Device experience policy](policy/DEVICE-EXPERIENCE.md): phone, tablet, laptop and desktop acceptance are separate.
- [Release candidate `7c26db7`](releases/candidate-7c26db7/README.md): proposed 0.3.0 notes, upgrade guide, support matrix and evidence; prepared, not released.

## Project

- [Brand](brand.md): logo, palette, ASCII banners and asset licence.
- [Provenance](PROVENANCE.md): where this engine came from.

## Control documents

Organized after the NASA software documentation guidance (NPR 7150.2D, NASA-STD-8739.8B,
SWEHB 7.18) as a self-assessed Class E analog. This is not a NASA compliance determination.
Each document carries a metadata header with its baseline commit; `npm run lint:trace`
checks the headers, the requirement trace and every relative link.

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

## Other guides and records

- [Predeclared acceptance evidence](guides/acceptance-evidence.md), [dimensional inventory candidates](guides/dimensional-inventory.md), [industrial state candidates](guides/industrial-candidates.md), [ordered industrial transfer batches](guides/industry-transfer-batches.md) and [progression inspection](guides/progression-inspection.md).
- [Optional pure kit package](guides/pure-package.md) and the [game brief template](guides/GAME.template.md).
- [Release notes draft for 0.2.0](guides/release-notes-0.2.0.md).
- Evidence records: [cellular WASM](verification/cellular-wasm/README.md), [indexed geometry](verification/indexed-geometry/README.md) and [lazy scene bodies](verification/lazy-scene-bodies-2026-09-30.md).
