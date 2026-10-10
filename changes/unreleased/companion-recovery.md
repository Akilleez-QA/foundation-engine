- **Companion recovery** in `@kits/breadcrumbs`: `createCompanionRecovery` tells a trail-following companion to
  follow, catch up with a distance-scaled speed boost, or teleport to a safe point on the trail behind the leader.
  Teleports happen when the companion is too far away or has made no progress for a set time, and the landing point
  is chosen by the creator's `canLand` check (for example free space that is out of view). Teleports have a cooldown.
  See [ADR 0155](docs/adr/0155-companion-recovery.md).
