# ADR 0112: optional camera director helpers

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Camera kit
- **Tracking:** linked from the pull request

## Context

The camera kit has six pure modes, exponential smoothing and clearance. Creators
building third-person or staged games also need several other pieces:

- authored areas that change how the camera behaves, resolved by priority and
  without flicker at boundaries;
- a camera that trails freely within a distance band;
- rails and inspection close-ups;
- shot moves for scripted moments;
- transitions that take as long as the change needs and arrive on time while the
  subject keeps moving;
- a return blend after a scripted shot;
- carrying the camera with a moving or turning platform;
- a letterbox.

## Decision

Add these as pure helpers in the camera kit (`director.ts`):

- a priority-ladder resolver over creator overrides, authored box and cylinder
  volumes with stickiness, and a fallback;
- string, rail, close-up and shot-move pose functions;
- a transition sized from the pose difference, using a triangular schedule that lands
  exactly on a moving goal, with support carry;
- a letterbox amount.

An optional `cameraDirectorSystem` composes them and writes the view only when it
changes. The existing `cameraSystem` is unchanged.

## Consequences

Creators name settings and supply rigs per setting. Volume data is creator-authored.
The director does not include occlusion steering, multi-subject framing, lock-on or
shake, and the letterbox is a value, not a renderer feature. Evidence is headless
tests; no browser, visual or device acceptance.
