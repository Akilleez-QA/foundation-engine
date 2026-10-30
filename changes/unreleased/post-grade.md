- **Post grade: lookup tables and an HDR ceiling (POST-02, #179).** `view.post.grade.lut: {file, strength}` applies a 3D
  `.cube` lookup table (side 2 to 65, under the game's `public/`) after lift, gain and saturation, inside the existing
  combined pass at `basic` and `full`: no extra post draw. The file is fetched with the visit's signal once the post
  chunk is ready (its reader ships in the chunk), up to 4 parsed tables are kept per page, and a failure is reported
  once while the scene keeps drawing without the table. `view.post.ceiling` (1 to 65504, opt-in) holds the linear HDR
  picture at or below a value, hue kept, in every bloom threshold tap and the combined pass; NaN pixels go black and
  infinities are clipped, so one over-range specular pixel no longer blooms into a disc. `cubeLutText` and
  `parseCubeLut` from `@engine` write and read tables (a game can generate one in `game/tools/`). Without the new
  fields nothing changes. The art-direction recipe and skill cover grading to a reference, fireflies and AgX for night
  scenes. Evidence: unit tests and `npm run test:post-browser` (`grade-post` at full and basic, software GL). The table
  texture is reported as `lutBytes`, not in `textureMiB`. No reference-GPU, physical-device or visual-quality
  acceptance.
