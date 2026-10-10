- **Audio extras.**
  - `ctx.view.listener` lets a scene hear from a creator position, such as the character's head, instead of the
    camera.
  - Platform voices gain `setRate` (ramped playback rate).
  - `@kits/audio-mixer` adds a camera-to-character listener blend, Doppler rates, retrigger pitch escalation and
    per-sound instance limits.
  - `@kits/audio-mixer` also adds adaptive music: a quantized musical clock and a stem director whose state changes
    land on beat, bar or phrase boundaries with beat-length fades and intensity hysteresis.
  - See [ADR 0153](docs/adr/0153-audio-listener-and-adaptive-music.md).
