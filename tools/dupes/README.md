# Duplicate and near-duplicate detector

`npm run dupes` lists files that repeat in a game's assets, or in any folders you
name, so a creator can remove waste, spot an asset shipped twice under two names, or
find files copied from another project. It only reads and reports; deciding what to
remove stays with the creator.

```sh
npm run dupes                                     # the active game's public/ folder
npm run dupes -- --game templates/mechanics/game  # another game
npm run dupes -- src tools                        # any folders or files
npm run dupes -- game/public --against ../other/assets   # only files shared across the two trees
npm run dupes -- --json --fail-on exact           # machine-readable; exit 1 when a match exists
```

| Match | How | Catches |
|---|---|---|
| exact | SHA-256 of the bytes, reported with the git blob id (`git hash-object`) | the same file under two names or folders; a file another repository holds, by blob id |
| geometry | GLB mesh data as values: attributes, indices (16- or 32-bit alike), sparse data and morph targets, in any mesh or primitive order | the same mesh re-exported with other names, materials, JSON layout or interleaving |
| image | 128-bit difference hash of PNGs (horizontal and vertical neighbours on a 9×9 luma grid) within `--image-distance` bits (default 10, at most 15) | resized, recompressed or slightly retouched copies |
| text | MinHash of comment-free 5-token shingles, banded into 16 buckets, at `--text-similarity` (default 0.85) | copied source or data with changed layout or comments |

Groups are single-linkage: members are linked by pairs within the threshold, and the
report gives the farthest image pair or least similar text pair of the whole group
(null for groups above 200 members, which are not compared pair by pair).

## Contract

- Owner: the caller. The scan reads files; nothing is written.
- Inputs: paths (default: the active game's `public/`), `--against` for cross-tree
  matches only, thresholds, `--max-files` (50,000), `--max-bytes` (64 MiB: larger
  files get exact matching only), `--min-bytes`.
- Bounds: one listing and one chunked hash per file; PNG decoding refuses data that
  inflates beyond the image's exact size and images above 2^26 pixels; identical
  image hashes are collapsed before comparison, and more than 2,000 distinct hashes
  are bucketed by 8-bit slices (exact for distances up to 15); a crowded text bucket
  is compared against 16 anchors rather than all pairs. Measured locally: about 900
  repository source files in 2–3 s, 6,300 files (204 MB) in about 20 s.
- Failure: unreadable folders and files, undecodable PNGs, flat (one-tone) images,
  compressed (Draco/meshopt) or externally buffered GLB geometry are listed under
  `skipped` with the reason; the scan continues. Symbolic links inside a tree are not
  followed; a symbolic-link root is.
- Exit status: 0 report, 1 `--fail-on` found a match, 2 wrong arguments, 3 the scan
  failed (for example more files than `--max-files`).

## Limits

Not compared: JPEG/WebP/KTX2 images and sounds (exact matching only), `.gltf` files
with external buffers, compressed GLB geometry, text shorter than 30 tokens. Text
copies with renamed identifiers are not found (shingles compare token sequences).
Flat images and images that differ only in colour, not structure, are not matched by
the image hash. A match is a candidate: shared licence files or generated textures may
repeat on purpose.

## Evidence

`tools/dupes/dupes.test.mjs` (in `npm test`): exact groups and their blob ids equal
`git hash-object`; renamed GLBs with equal mesh data match while different data,
sparse values and morph targets do not; 16- and 32-bit index storage match; resized
and noisy PNGs match and unrelated ones do not; reformatted source matches and other
source does not; `--against` reports only cross-tree groups; the PNG decoder equals a
real renderer's pixels (adaptive filters), Adam7 and 4-bit palette images; a
decompression bomb is refused; a 300-file family and 400 identical-hash images are
grouped; chain scores cover every pair; unreadable folders and symlinked roots;
CLI statuses. An independent adversarial review found thirteen defects (including a
decompression bomb, large families hidden by a bucket cap, quadratic memory for
look-alike images, chain scores, flat-image false positives and geometry false
positives); each is fixed with a regression test.
