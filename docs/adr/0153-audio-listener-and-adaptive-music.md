# ADR 0153: listener placement, voice rate and adaptive music

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Author view / Platform audio / Optional kits

## Context

In third-person games the camera is the wrong point to hear from: sounds next to the character seem distant, and
sounds next to the camera seem loud. Moving sources and rapid retriggers want pitch changes on voices that are already
playing. Adaptive soundtracks layer stems by game intensity and switch only on musical boundaries, so the music never
lurches mid-bar.

Foundation's runtime always put the listener at the camera. Voices could set a rate only when they started, and
nothing quantized musical changes, although songs already play on the audio clock.

## Decision

- **Listener.** Add an optional `ctx.view.listener` (`position`, plus optional `forward` and `up`). The runtime sends
  it to the audio output in place of the camera position. Absent or invalid values fall back to the camera; invalid
  ones are reported once.
- **Voice rate.** Add an optional `CueVoice.setRate(rate, timeConstant)` ramp, within the existing rate limits.
- **Kit helpers.** Extend `@kits/audio-mixer` with pure helpers:
  - a listener blend;
  - Doppler rates;
  - retrigger pitch escalation;
  - per-key instance limits;
  - a quantized music clock;
  - a stem director with boundary-quantized transitions, beat-length fades and intensity hysteresis.

## Consequences

Scenes that do not set a listener are unchanged. Creators own stem files, their start times and how gains are
applied. The director changes gains only when it is pumped and does not schedule ahead on the audio clock, so its
timing follows the frame cadence; at 60 Hz that error is at most one frame. There is no device listening evidence.
