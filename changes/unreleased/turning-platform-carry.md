- **Turning-platform carry (locomotion kit).** A moving platform's path may also return `yaw`. Riders are then carried
  about the platform's pivot by each tick's exact yaw change, their facing turns with it (`carryFacing`, default
  true), support uses the turned footprint, and leaving keeps the tangential velocity. Bounds: `maxTurnRate`, wrapped
  yaw and a corner speed check. Platforms without yaw are unchanged. See the
  [locomotion kit](src/kits/locomotion/README.md#turning-platforms) and
  [ADR 0160](docs/adr/0160-turning-platform-carry.md).
