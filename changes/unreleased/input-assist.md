- **Aim assist, flick detection and scripted input playback.** The optional
  [`@kits/input-assist`](src/kits/input-assist/README.md) selects aim targets in a cone, adds rate-limited magnetism
  that only acts while the user aims and never passes the target, and slows aim near targets; zero strengths are an
  exact identity. It also detects stick or pointer flicks with 4- and 8-way directions and re-arm hysteresis.
  [`@kits/input-history`](src/kits/input-history/README.md#scripted-playback) now plays action timelines (or converted
  recordings) as normal input for tests and attract mode, looping, and cancelled by real input. Headless tests only;
  see [ADR 0119](docs/adr/0119-input-assist.md).
