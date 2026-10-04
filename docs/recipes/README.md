# Recipes

Short, checked how-tos. Start with [getting started](../guides/getting-started.md) if you have not made a game yet. Every code block in the cookbook recipes was compiled, tested and run in a scratch game made from a template.

## Cookbook: making your game

| I want to… | Recipe |
|---|---|
| know where my models, textures, sounds and asset-making scripts go | [where your game's files go](your-game-files.md) |
| show a `.glb` model and play its animation (KTX2 textures for phones included) | [load a model](load-a-model.md) |
| make a model with an agent in Blender (optional MCP), export it reproducibly and check it against its size, budget and licence contract | [make assets with Blender through MCP](make-assets-with-blender-mcp.md) |
| show a score, messages, a tap action and a button | [HUD text and buttons](hud-and-buttons.md) |
| collect things by touching them, block movement, click or tap the ground | [collision and picking](collision-and-picking.md) |
| make the player jump, with a short hop on a quick tap | [add and tune a jump](tune-a-jump.md) |
| add lifts and moving platforms the player can ride | [add moving platforms](add-moving-platforms.md) |
| follow the player with the camera, change light, sky colour and haze | [camera and lighting](camera-and-lighting.md) |
| texture a shape, make it shiny, glowing or see-through | [give a shape a material](give-a-shape-a-material.md) |
| make my game look good: palette, light presets, haze, framing, low-poly forms, baked light, the look checklist | [art direction](art-direction.md) |
| show hit sparks, pickup glitter and bursts, trails or smoke | [hit sparks and pickups](hit-sparks-and-pickups.md) |
| test that effects start on animation markers, fire once, stack, stop with their owner and reuse cleanly | [test your effects' lifecycles](test-effect-lifecycles.md) |
| play my own sound effects, with volume, pitch and position | [play your own sound files](play-your-own-sounds.md) |
| line up events, sounds or scoring with the music the player hears | [sync gameplay to music](sync-gameplay-to-music.md) |
| let players locate unseen opponents by sound: direction and distance | [3D sound for shooters](3d-sound-for-shooters.md) |
| put my game on the web | [share your build](share-your-build.md) |
| host it in a folder (GitHub Pages project site, itch.io) | [host a build under a sub-path](host-under-a-sub-path.md) |
| play with a friend: two players in one world on my machine or LAN | [two players in one world](two-players-one-world.md) |

## Building blocks

| I want to… | Recipe |
|---|---|
| add a level, menu or area | [add a scene](add-a-scene.md) |
| add data to things, or a reusable prefab | [add an entity and component](add-an-entity-and-component.md) |
| add a rule that runs every step | [add a system](add-a-system.md) |
| add a control | [add an input action](add-an-input-action.md) |
| keep progress across reloads | [add a save section](add-a-save-section.md) |
| store the edits of a large world, beyond what a save section holds | [store large edited worlds](store-large-world-records.md) |
| build levels or terrain from a seed, off the frame, the same every time | [generate seeded content](generate-seeded-content.md) |
| accept early presses, detect releases and match input sequences | [add input history](add-input-history.md) |
| play the game in a browser by script: keys, waits, checks, screenshots, a page reload | [write a playtest script](write-a-playtest-script.md) |
| write counts, positions (1st, 2nd) and variants in text | [plurals, ordinals and variants](write-plurals-ordinals-and-variants.md) |
| branch a conversation on variables and visits | [add branching dialogue](add-branching-dialogue.md) |
| test a scene without a browser: presses, plays, scene changes, saves | [test a scene](test-a-scene.md) |
| measure or lower a scene's performance budget | [add a budget](add-a-budget.md) |
| check a scene replays exactly, ignoring cosmetic motion | [replay with your own digest](replay-with-your-own-digest.md) |

## Optional kits: turns, many entities and networked play

| I want to… | Recipe |
|---|---|
| keep a turn log with undo, redo, preview and replay | [add a deterministic turn log](add-a-turn-log.md) |
| answer "who is near me" for many entities without comparing every pair | [use a spatial index](use-a-spatial-index.md) |
| show each observer only the entities near it, ranked and capped | [per-observer interest sets](use-interest-sets.md) |
| let peers share one simulation and correct by rolling back | [add rollback sessions](add-rollback-sessions.md) |
| reject impossible or too-frequent commands at an authoritative host | [add command integrity](add-command-integrity.md) |

## Extending the engine

| I want to… | Recipe |
|---|---|
| share a genre pattern between games | [add a kit](add-a-kit.md) |
| add a starting game | [add a template](add-a-template.md) |
| upgrade a public API consumer | [compatibility and upgrades](../guides/public-compatibility.md) |
| publish a separately compiled content bundle | [publish content](publish-content.md) |

Something missing? The README's [Not here yet](../../README.md#not-here-yet-and-workarounds) lists features that do not exist today and the workaround for each.
