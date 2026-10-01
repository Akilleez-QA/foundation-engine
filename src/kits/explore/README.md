# kits/explore

Move-and-interact: `Interactable` things (a string-key `label`, a `reach`, and for doors `to`/`toX`/`toZ`), prompted through the ui kit when the player is in reach and used with the kit's `explore-interact` action (E, Enter, Space, pad A, tap). A use fires the world event `interact` `{ id }`, is remembered in the save section `explore.progress` (`used`, `visited`, `last`), and a door goes to its scene, placing the player at the arrival point. Requires the ui kit; pairs with the character and camera kits. Cost: one pass over interactables per fixed step.
