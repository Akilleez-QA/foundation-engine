import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MIN_NODE, nodeVersionProblem} from './node-version.mjs';

test('the Node guard accepts versions with built-in type stripping and names the floor for older ones', () => {
  for (const ok of ['22.18.0', 'v22.18.0', '22.23.3', '23.6.0', '24.0.0', '26.8.1'])
    assert.equal(nodeVersionProblem(ok), null, ok);
  for (const old of ['20.20.2', '22.12.0', '22.17.1', '23.5.0', '18.0.0']) {
    const problem = nodeVersionProblem(old);
    assert.ok(problem && problem.includes(MIN_NODE) && problem.includes(old), old);
    assert.ok(!problem.includes('\n'), 'one line');
  }
});

test('package.json engines, .nvmrc and .node-version state the same Node floor as the guard', () => {
  const root = new URL('../../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.engines.node, '>=22.18');
  assert.equal(MIN_NODE, '22.18.0');
  for (const file of ['.nvmrc', '.node-version'])
    assert.equal(readFileSync(new URL(file, root), 'utf8').trim(), '22', file);
});
