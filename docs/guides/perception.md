# Perception: senses, awareness and tactical choices

The optional `perception` kit turns what an agent could notice into facts a decision
system can use. Each think step:

1. Measure stimuli. Use `sightStrength` with your own line-of-sight query (a
   volume-query sweep, a ray against level geometry, or a grid check), and
   `hearingStrength` for the sounds your game emits, optionally with a navigation
   distance so sound goes around walls.
2. Feed them to the agent's `createAwareness()` with the current time. Awareness rises
   while a target is seen, jumps when it is heard or reported, and decays otherwise.
   Levels move between unaware, suspicious and alerted with hysteresis, so agents do
   not flicker.
3. Write `awareness.facts()` into your blackboard (a behaviour tree runtime's `set`
   works) and let your tree or state machine decide.

Squads share what they know: `share` puts a member's suspicious or alerted targets on
the squad board, and `inform` gives the others fading report stimuli. For combat
positions, `chooseCover` finds the nearest unreserved point your line-of-sight query
says is hidden from the threat. For choosing between actions or weapons, `chooseUtility`
scores options from considerations in [0, 1], with momentum so choices do not dither.

See [the kit README](../../src/kits/perception/README.md) for every bound and rule.
