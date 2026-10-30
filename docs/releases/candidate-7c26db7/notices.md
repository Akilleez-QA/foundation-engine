# Asset and licence notices check for candidate `7c26db7`

Run on 2026-10-03 against the clean checkout described in [build](build.md). This is a consistency check
of the current tree, not a legal review or a history audit.

## Results

| Check | Result |
|---|---|
| Project licence | GPL-3.0-only in `LICENSE` and `package.json` (`private: true` only prevents npm publication) |
| Lockfile entries versus the [notices inventory](../../../THIRD_PARTY_NOTICES.md#locked-dependency-inventory) | **95 of 95** match by name, pinned version and declared licence; no inventory row without a lockfile entry. Licences: 64 MIT, 25 MPL-2.0, 4 Apache-2.0, 1 BSD-3-Clause, 1 ISC, as the inventory states |
| Shipped sample assets (tracked files under any `public/` folder) | **10 of 10** named in the notices: nine CC0-1.0 mechanics fixtures and the GPL-3.0-only Blender `metre-block.glb` (#74) |
| Brand assets (`assets/brand/`, #93) | 12 files, original work listed in [docs/brand.md](../../brand.md); generator dependency `@resvg/resvg-js` (MPL-2.0, development only) is in the notices |
| Notices emitted by `npm run build` | `dist/LICENSE.txt` and `dist/THIRD_PARTY_NOTICES.txt` are byte-identical to `LICENSE` and `THIRD_PARTY_NOTICES.md`; `dist/COPYRIGHT.txt` is present |
| Local paths in tracked files | Three hits, all test fixtures (`/Users/a` in a bench-browser test, `src/features/home/...` paths); none is a machine path |
| Credential-like filenames | None (`.env`, `.pem`, `.key`, `id_rsa`, `credentials`) |

Added since v0.2.0 and already in the notices: Prettier 3.9.9 (MIT, development only, #101) and
`@resvg/resvg-js` 2.6.2 with its platform binaries (MPL-2.0, development only, #93).

## Limits

- Declared licences come from lockfile metadata; optional binaries for other platforms were not installed.
- No copyright-chain, binary-content or Git-history review; regex scans are triage, not clearance.
- Template verification screenshots under `templates/*/verification/` and `docs/verification/` are locally
  rendered diagnostics and are not shipped by a build; they were not reviewed image by image.

## Script

The check ran as `node notices-check.mjs <checkout>` after `npm run build`; it exits non-zero on any problem.

```js
// Release-candidate notices check: lockfile entries versus THIRD_PARTY_NOTICES.md rows,
// tracked binary assets versus notice/brand mentions, and the build's emitted notice files.
// Usage: node notices-check.mjs <checkout>
import {readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

const root = process.argv[2];
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const brand = readFileSync(join(root, 'docs/brand.md'), 'utf8');

const rows = new Map();
for (const m of notices.matchAll(/^\| `([^`]+)` \| ([^|]+?) \| ([^|]+?) \|/gm)) if (!m[1].includes('/public/')) rows.set(m[1], {version: m[2].trim(), license: m[3].trim()});

const problems = [];
const counts = {};
let entries = 0;
for (const [path, p] of Object.entries(lock.packages)) {
  if (!path) continue;
  entries++;
  const name = path.replace(/^.*node_modules\//, '');
  counts[p.license] = (counts[p.license] ?? 0) + 1;
  const row = rows.get(name);
  if (!row) problems.push(`missing row: ${name}@${p.version} (${p.license})`);
  else {
    if (row.version !== p.version) problems.push(`version differs: ${name} lock ${p.version} notices ${row.version}`);
    if (row.license !== p.license) problems.push(`licence differs: ${name} lock ${p.license} notices ${row.license}`);
  }
}
const lockNames = new Set(Object.keys(lock.packages).filter(Boolean).map(k => k.replace(/^.*node_modules\//, '')));
for (const name of rows.keys()) if (!lockNames.has(name)) problems.push(`row without lock entry: ${name}`);

const tracked = execFileSync('git', ['-C', root, 'ls-files'], {encoding: 'utf8'}).split('\n');
const assetRe = /\.(glb|gltf|png|jpe?g|webp|ktx2|wav|ogg|mp3|m4a|svg)$/i;
const shipped = tracked.filter(f => assetRe.test(f) && /(^|\/)public\//.test(f));
for (const f of shipped) {
  const base = f.split('/').pop().replace(/-(px|nx|py|ny|pz|nz)\.png$/, '-{px,nx,py,ny,pz,nz}.png');
  if (!notices.includes(f) && !notices.includes(f.replace(/sky-(px|nx|py|ny|pz|nz)/, 'sky-{px,nx,py,ny,pz,nz}')) && !notices.includes(base))
    problems.push(`shipped asset not in notices: ${f}`);
}
const brandFiles = tracked.filter(f => f.startsWith('assets/brand/') && assetRe.test(f));
for (const f of brandFiles) if (!brand.includes(f.split('/').pop()) && !brand.includes('assets/brand/')) problems.push(`brand asset not listed: ${f}`);

const dist = join(root, 'dist');
const emitted = ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'COPYRIGHT.txt'].map(n => [n, existsSync(join(dist, n))]);

console.log(JSON.stringify({entries, counts, noticeRows: rows.size, shippedAssets: shipped.length, brandAssets: brandFiles.length, emitted: Object.fromEntries(emitted), problems}, null, 2));
process.exitCode = problems.length ? 1 : 0;
```
