import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import config from '../vite.config.ts';

const barrel = fileURLToPath(new URL('../src/author/index.ts', import.meta.url));

test('vite config: the @engine barrel declared side-effect free contains only re-exports', () => {
  const source = ts.createSourceFile(barrel, readFileSync(barrel, 'utf8'), ts.ScriptTarget.Latest, true);
  const other = source.statements.filter(s => !ts.isExportDeclaration(s) || !s.moduleSpecifier);
  assert.deepEqual(other.map(s => ts.SyntaxKind[s.kind]), [], 'src/author/index.ts must stay a pure `export … from` barrel');
});

test('vite config: only the @engine barrel is declared side-effect free; every other module keeps the default', () => {
  const sideEffects = config.build.rolldownOptions.treeshake.moduleSideEffects;
  assert.equal(sideEffects(barrel, false), false);
  assert.equal(sideEffects(barrel.replace(/\//g, '\\'), false), false);
  for (const id of ['game/src/author/index.ts', 'src/author/testing.ts', 'src/platform/workers/host.ts', 'node_modules/three/src/Three.js', 'src/kits/terrain/index.ts']) {
    assert.equal(sideEffects(fileURLToPath(new URL(`../${id}`, import.meta.url)), false), undefined, id);
  }
});
