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
- [Kit catalog](kits/README.md): optional patterns a game can choose, configure or leave out.
- [Labs](guides/labs.md): prove one system (a mechanic, a kit, a technique) in a small isolated game before building a world on it, then graduate it into the engine.
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
- [Release candidate `ffa8c6a`](releases/candidate-ffa8c6a/README.md): proposed 0.3.0 notes, upgrade guide, support matrix, evidence and simulated trials; prepared, not released. It replaces the stale [`7c26db7`](releases/candidate-7c26db7/README.md) bundle.

## Project

- [Brand](brand.md): logo, palette, ASCII banners and asset licence.
- [Provenance](PROVENANCE.md): where this engine came from.
