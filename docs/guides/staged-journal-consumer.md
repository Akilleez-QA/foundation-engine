# Optional staged journal consumer

`tools/stage-journal/index.html` is a desktop keyboard/pointer example that composes
existing staged objectives, action runs, inventory, capabilities, HUD disclosure and
save sections. It demonstrates one creator-authored workflow. It introduces no
journal manager, reward service, global clock or mandatory progression design.

Run the development server and open `/tools/stage-journal/index.html?flags=dev.silent`.
The normal player entrypoint does not import this tool. The layout keeps controls
beside the rendered scene. Journal details use the existing HUD reading sheet and
its visit-owned layer, including pause, dismissal and focus restoration.

## Authored behavior and ownership

The pinned `calibration-v1` definition has two stages. Each requires one accepted
delayed action. Pressing **Perform action** starts an action run; it does not add
progress. The existing scene frame system supplies time. At readiness, the
controller records the consequence, publishes its candidate envelope, then
acknowledges the action. Requirements becoming ready does not finish a stage:
**Continue to confirmation** and **Finish run** are explicit choices.

Completing the run leaves reward delivery pending. The example's collection has
one slot, initially occupied by a stored sample. A delivery attempt reports
capacity without changing inventory, capability or receipt. **Release stored
sample** frees the slot; **Deliver reward** retries the same authored claim.

A successful candidate contains the objective snapshot, one inventory token, an
earned capability with completion evidence/provenance, and its receipt in **one
existing save section**. The parser checks that those consequences agree. The
sample's three permitted inventory operations also have exact authored payloads.
A receipt separated from its inventory or progression consequence is invalid and
enters the existing save quarantine path on reload.

The controller reads the save handle's accepted in-memory envelope after every
operation. A rejected storage write may still accept that complete envelope in
memory. The UI then says `Unsaved` with the current save status. It does not roll
back an accepted reward or pretend it is durable. Retrying delivery in that page
session observes the receipt and does not duplicate output. **Retry save** republishes
the same accepted envelope; automatic retries by the save owner also remain valid.
Reload restores what actually reached storage. If the unsaved reward was lost on
reload, the prior pending envelope can deliver again; no external effect was sent.

Run cancellation cancels pending action ownership and records cancellation. Scene
exit retires the controller and its pending work. Pending actions deliberately do
not survive reload or scene replacement; accepted objective progress does. The
controller has no repeating timer and cannot publish after disposal. One visit
retains at most 32 action identities; the run contains at most two stages with four
accepted event slots per stage. Inventory admits eight operation slots; this fixed
consumer uses three. The framework APIs' larger general limits remain separate.

## Acceptance and limits

Focused real-SaveStore tests:

```sh
node_modules/.bin/tsx --test tools/stage-journal/controller.test.mjs
```

Muted isolated browser acceptance:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/stage-journal-check.mjs playtest/stage-journal
```

The browser script checks delayed accepted work, paused work while reading,
ready-versus-terminal display, stage reload, capacity denial, failed storage,
exact retry, coherent reward reload, corrupt-envelope quarantine, cancellation and
scene replacement. It records screenshots and a revision-specific `report.json`.
A runnable check is not a claim it passed: use that report for the tested revision.
Root CI wiring and configured execution are recorded separately from this guide.

This consumer selects desktop at 1440×960 for emulated acceptance. It makes no
phone/tablet, physical-device or full accessibility certification. It does not
provide arbitrary quest authoring, concurrent-writer isolation, remotely authorized
rewards, external side-effect rollback or durable in-flight actions. Other games
can replace the sample's timing, labels, reward, capacity and progression policies.
