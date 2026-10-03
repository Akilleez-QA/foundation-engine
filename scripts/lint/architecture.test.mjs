import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {scanPatterns} from './architecture.mjs';

/** A throwaway src/ tree holding `files` ({path: source}); returns its root and a cleanup. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'arch-lint-'));
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), text); }
  return {root, done: () => rmSync(root, {recursive: true, force: true})};
}

const files = (counts, rule) => Object.values(counts[rule]).flatMap((b) => Object.keys(b.files)).sort();

test('lint:arch: three/webgpu and three/tsl are allowed only in the WebGPU backend folder (ADR 0078)', () => {
  const f = fixture({
    'platform/render/backends/webgpu/backend.ts': "import { WebGPURenderer } from 'three/webgpu';\nimport { uniform } from 'three/tsl';\n",
    'platform/render/backends/webgpu/nested/lazy.ts': "export const load = () => import('three/webgpu');\n",
    'platform/render/backends/webgl/backend.ts': "import 'three/tsl';\n",
    'platform/render/renderer-pool.ts': "export const load = () => import('three/webgpu');\n",
    'platform/render/webgpu-helper.ts': "import { Fn } from 'three/tsl';\n",
    'kits/fx/index.ts': "import * as W from 'three/webgpu';\n",
    'author/runtime.ts': "import { WebGPURenderer } from 'three/webgpu';\n",
    'core/ok.ts': "import * as THREE from 'three'; // three/webgpu in a comment is not code\n",
  });
  try {
    assert.deepEqual(files(scanPatterns(f.root).counts, 'three-webgpu'), [
      'author/runtime.ts', 'kits/fx/index.ts', 'platform/render/backends/webgl/backend.ts',
      'platform/render/renderer-pool.ts', 'platform/render/webgpu-helper.ts',
    ]);
  } finally { f.done(); }
});

test('lint:arch: new WebGLRenderer is allowed only in the pool and the WebGL backend folder', () => {
  const make = 'export const r = new THREE.WebGLRenderer({ canvas });\n';
  const f = fixture({
    'platform/render/renderer-pool.ts': make,
    'platform/render/backends/webgl/backend.ts': make,
    'platform/render/backends/webgpu/backend.ts': make,
    'kits/fx/index.ts': make,
  });
  try {
    assert.deepEqual(files(scanPatterns(f.root).counts, 'webgl-renderer'), ['kits/fx/index.ts', 'platform/render/backends/webgpu/backend.ts']);
  } finally { f.done(); }
});
