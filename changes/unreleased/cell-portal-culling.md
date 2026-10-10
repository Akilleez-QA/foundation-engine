- **Optional cell and portal culling.** `@kits/cells`: creator cells and portals with open state, a bounded flood
  from the camera's cells narrowing a screen rectangle per portal (conservative near the eye and on portal planes),
  a depth-bounded PVS bit table and a culler that writes visibility only for targets that flip, through engine
  components or three.js objects. Headless tests only. See [ADR 0145](docs/adr/0145-cell-portal-culling.md) and
  the [guide](docs/guides/cell-culling.md).
