# Policy profile: kid-safe (opt-in)

The engine's default player protection (STD-PRI-7) is neutral: saved progress never un-happens and saved data is never destroyed. A game for young players opts in to this profile by setting `audience: { kids: true }` in its build brief (`defineBuild`), which sets `brief.policy` to `'kid-safe'`. The learn template opts in by default. The game names the profile in its `docs/APPLICATION.md` and keeps every rule below. Where a rule can be a type or a data check, it is one: a rule enforced only by convention does not count (law 12).

## Rules

| # | Rule | Enforce with |
|---|---|---|
| K1 | **No locks.** Every scene the game lists can be entered from the first session. Progress unlocks cosmetics and extras, never access to content. | Scene rows carry no condition; a lock needs a reviewed exception in APPLICATION.md |
| K2 | **No grind.** No reward requires repeating the same action more than `brief.kidSafe.maxRepeat` times (default 5). | A check in the game's (or kit's) reward rows |
| K3 | **No deadlines or failure states.** Tasks have no timers, expiry or decline penalties. Setting one aside keeps its progress. | Task rows have no time or failure fields |
| K4 | **Nothing earned is taken back.** Points, items and unlocks are never removed as a penalty. Spending is the player's choice, and never required to continue. | Grants only add (STD-REG-24); save sections merge by maxima and unions |
| K5 | **No harm to characters.** No death, injury or destroyed state for any character the player cares about. Every failure ends recovered. | Component types have no destroyed variant |
| K6 | **No purchases, ads, chat or links out.** Nothing leaves the device. There are no external links without a grown-up gate. | Hermetic network in every bench; assets are served with the game (`defineAsset` rejects other sites) |
| K7 | **No personal data.** Player names stay on the device. Export files are the player's own. There is no analytics. | The save store only; `perf` numbers never leave the device (STD-PRF-10) |
| K8 | **Legible and calm.** Text is keyed, with a `standard` reading level; a `@detailed` level is for grown-ups. Calm (reduced motion) is honoured everywhere. No flashing above 3 Hz, and no post-processing that reduces legibility. | String keys (STD-STR-1); Calm from the frame (STD-RUN-8, STD-RUN-32) |
| K9 | **Grown-up tools are separate.** Settings that change data (reset, import, player management) sit behind a grown-up affordance, labelled at the `@detailed` level. | Shell rows with `level: 'detailed'` |
| K10 | **Audio is gentle and optional.** Mute is one key (M) and one menu button. There is no audio in tests, ever. | `core.mute`; `platform.audio` is silent under automation |

## Adopting the profile

1. Set `audience: { kids: true }` in `build.brief.ts` and record the change in GAME.md's changelog.
2. State it in `docs/APPLICATION.md`: "Player protection profile: kid-safe".
3. Add the checks for K2, K3 and K6 to your registries' `validate`/`problems`. They are small; APPLICATION.md lists where each one lives.
4. Add a row to the review checklist: every new mechanic states which K-rules it touches.
