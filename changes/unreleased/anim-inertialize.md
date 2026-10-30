- **Inertialized pose transitions in the animation kit.** `createInertializer(joints)` switches pose sources at once
  and hides the switch by decaying the outgoing-minus-incoming offset (position, shortest-hemisphere rotation and
  their velocity difference) to zero with a quintic over `blendTime`: position and velocity are continuous at the
  switch, and the offset ends with zero velocity. A new `switchTo` replaces a blend in progress; `sample` reuses one
  preallocated buffer. Bounded to 128 joints in a fixed order, finite inputs, `blendTime` 0-2 s and `dt` 1e-4-1 s;
  invalid input throws before any state changes. Pose-level only: not wired to the `Model` component, no browser or
  device evidence ([animation kit README](src/kits/animation/README.md)).
