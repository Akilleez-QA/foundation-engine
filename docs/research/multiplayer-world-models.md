# Generative multi-player world models: hierarchical communication

Research pass: 2026-10-18. Status: study only; nothing adopted, no code copied.

Source studied: *Multics: Generative Multi-Player World Model with Hierarchical Communication* (Huang, Yu, Huang,
Yu, Liu, Yang, Hu, Shan, Liu; The University of Hong Kong and Tencent ARC; [arXiv 2610.17201](https://arxiv.org/abs/2610.17201);
[project page](https://karine-huang.github.io/Multics/); [code](https://github.com/TencentARC/Multics), Apache-2.0,
weights on Hugging Face). Unrelated to the 1960s operating system of the same name.

## What it is

A video diffusion model that jointly generates one first-person video per player of a shared multiplayer match.
Each video is conditioned on that player's first frame, discrete controls and mouse yaw/pitch, and camera pose in
a shared frame. It is built on a 5B-parameter text/image-to-video diffusion transformer with diffusion forcing,
and trained on OpenCS2, an open dataset rendered from ten-player matches of a commercial tactical shooter
(352×640, 165-frame clips).

## Mechanism worth noting: relevance-grouped communication

Fully connected cross-player attention costs grow quadratically with player count. Multics adds two token levels:

- **Group tokens** (5 per group slot, parameters shared across slots): players in the same group attend directly to
  each other.
- **Global tokens** (6 per latent frame): connect groups. Players in no group reach others only through them.
- **Grouping** comes from pairwise relevance over recent camera states: proximity and view-direction alignment,
  max-combined with mutual field-of-view visibility. There are ⌈log₂N⌉ group slots. A player is in at most two
  groups and two groups share at most one player. Grouping updates every 48 frames, and relevance only shapes the
  attention mask.
- **Players are permutation-equivariant** (simplex rotary encoding). With shared group parameters, a model trained
  on 4 players runs at 6, 8 and 10 players without retraining.

Reported, all from the paper:
- **Cross-player consistency:** geometric keypoint matching 54.2% against 48.5% and 49.4% for a fully connected
  and a centralised baseline at 4 players, and 51.5% at 10 players from a 4-player model.
- **Self-attention cost:** about 9.6 against 69.1 TFLOPs at 10 players.
- **No real-time claim:** 50 denoising steps, and GPU memory scales from 60 GiB (4 players) to 106 GiB (10 players)
  for 165 frames.
- **Stated limits:** no persistent world state over long horizons, and backbone artefacts under large motion.

## Fit with Foundation

Not a runtime candidate: it needs data-centre GPUs, is not real time, and has no persistent authoritative state.
The transferable idea is the **communication topology**, which matches problems Foundation already owns:

| Multics idea | Foundation owner | Possible use |
|---|---|---|
| Relevance from proximity + facing + mutual visibility | spatial interest sets, replication scheduler | a relevance score that adds mutual field-of-view to distance when ranking per-recipient updates |
| ⌈log₂N⌉ overlapping groups plus a global channel | network views, replication | grouped relay of shared events: dense exchange inside a group, summaries across groups, bounded cost as N grows |
| Regrouping on a fixed cadence with hysteresis | update cadence, region activation | stable group membership that avoids churn |
| Permutation-equivariant player slots | lockstep/rollback sessions | design tests and APIs so adding a peer needs no per-slot special cases |

Any such change would follow the usual bar: a named consumer, explicit bounds and overload behaviour, and measured
cost. A world-model client is out of scope.
