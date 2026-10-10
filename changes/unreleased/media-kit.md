- **Optional medium volumes** (`@kits/media`): box-shaped water, mud and similar regions with a floor and
  surface height (half-open edges, so flush volumes leave no seam), a bounded per-actor tracker for dry, wade,
  swim and under with hysteresis and enter, exit and state events, and pure buoyancy, drag and current
  accelerations. Volumes can be replaced every step for tides and moving water. See
  [ADR 0152](docs/adr/0152-medium-volumes.md).
