- **play:snap judges the settled scene and reports the warm-up (#180).** Each view now measures from the moment the scene
  opens until its per-frame draws, post draws and triangles agree within 5 % across three consecutive 600 ms windows
  (at most 8 s), then takes its pictures and the windows the budget is judged on. A scene that draws more on its first
  frames (programs compiling, passes started a few frames in, geometry settling) used to be judged partly on those
  frames. A `warm-up` line prints the first window after open beside the settled one; `probe.json` records `warmUp`
  and `settle` per view. Shadow passes, shadow casters and texture memory are unchanged: still the busiest frame and
  the total since the scene opened, as the gate measures them. A snap takes about 2 s longer per view (more while a
  scene settles).
