import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT, SETUP_ONLY, WORKFLOW, parseArgs, parseYaml, planFromWorkflow, selectSteps} from './gate-ci.mjs';

const ci = readFileSync(join(ROOT, WORKFLOW), 'utf8');

test('gate:ci: every run step of ci.yml is executed locally, except the documented setup-only steps', () => {
  const plan = planFromWorkflow(ci);
  // An independent count of `run:` keys, so a parser that dropped a step would fail here.
  const runKeys = ci.split('\n').filter(l => /^\s*(-\s+)?run:/.test(l)).length;
  assert.equal(plan.steps.length + plan.setup.length, runKeys, 'a ci.yml run step is neither executed nor setup-only');
  for (const cmd of Object.keys(SETUP_ONLY)) assert.ok(plan.setup.some(s => s.run === cmd), `SETUP_ONLY entry "${cmd}" is no longer in ${WORKFLOW}; remove it`);
  const ids = plan.steps.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('test:ui-browser') && ids.includes('gate:templates'));
  assert.ok(plan.steps.some(s => /GAME_DIR=templates\/expedition\/game npm run test:framework-browser/.test(s.run)));
  assert.equal(plan.node, '22');
  // Same order as the workflow.
  const order = [...ci.matchAll(/run: (?:GAME_DIR=\S+ )?npm run (?:-s )?([\w:.-]+)/g)].map(m => m[1]);
  assert.deepEqual(ids.filter(id => order.includes(id)), order.filter(id => ids.includes(id)));
});

test('gate:ci: the YAML subset keeps block scalars and merges workflow, job and step env', () => {
  const plan = planFromWorkflow(`
jobs:
  only:
    runs-on: ubuntu-latest
    env:
      A: job
      B: job
    steps:
      - uses: actions/setup-node@abc # pinned
        with:
          node-version: 22
      - run: npm ci
      - name: "Two lines"
        env:
          B: step
        run: |
          echo one   # kept: comments inside a block scalar are shell
          echo two
      - run: GAME_DIR=x npm run test:thing
`);
  assert.deepEqual(plan.actions, ['actions/setup-node@abc']);
  assert.equal(plan.setup.length, 1);
  assert.equal(plan.steps[0].run, 'echo one   # kept: comments inside a block scalar are shell\necho two');
  assert.deepEqual(plan.steps[0].env, {A: 'job', B: 'step'});
  assert.equal(plan.steps[0].id, 'two-lines');
  assert.equal(plan.steps[1].id, 'test:thing');
  assert.deepEqual(parseYaml('on:\n  push:\n    branches: [main]\n'), {on: {push: {branches: ['main']}}});
});

test('gate:ci: workflow features it cannot mirror are errors, not silent skips', () => {
  const wf = extra => `jobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo hi\n${extra}`;
  assert.throws(() => planFromWorkflow(wf('        if: always()\n')), /"if" cannot be mirrored/);
  assert.throws(() => planFromWorkflow(wf('        shell: sh\n')), /"shell" cannot be mirrored/);
  assert.throws(() => planFromWorkflow(wf('    strategy:\n      matrix:\n        os: [a, b]\n')), /strategy/);
  assert.throws(() => planFromWorkflow(wf('  b:\n    runs-on: x\n')), /exactly one job/);
  assert.throws(() => planFromWorkflow(wf('        env:\n          T: ${{ secrets.X }}\n')), /GitHub expressions/);
  assert.throws(() => parseYaml('a: >\n  folded\n'), /folded/);
});

test('gate:ci: --from and --only select steps by id, number or name', () => {
  const {steps} = planFromWorkflow(ci);
  assert.equal(selectSteps(steps, {from: 'gate:templates'})[0].id, 'gate:templates');
  assert.deepEqual(selectSteps(steps, {only: ['2', 'Full gates for every template']}).map(s => s.id), ['test:diagnostics-browser', 'gate:templates']);
  assert.equal(selectSteps(steps, {}).length, steps.length);
  assert.throws(() => selectSteps(steps, {from: 'nope'}), /no step "nope"/);
  assert.throws(() => selectSteps(steps, {from: '1', only: ['2']}), /not both/);
  assert.deepEqual(parseArgs(['--only', 'a,b', '--only', 'c']).only, ['a', 'b', 'c']);
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
});

test('gate:ci: runs serially with the step env and stops at the first failure with a summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-ci-'));
  try {
    const file = join(dir, 'ci.yml'), mark = join(dir, 'third');
    writeFileSync(file, `jobs:\n  a:\n    runs-on: x\n    steps:\n      - name: First\n        env:\n          GATE_CI_PROBE: seen\n        run: test "$GATE_CI_PROBE" = seen && test "$CI" = true\n      - name: Second\n        run: |\n          false | true\n          exit 3\n      - name: Third\n        run: touch ${mark}\n`);
    const r = spawnSync(process.execPath, ['scripts/gate-ci.mjs', '--workflow', file, '--any-node'], {cwd: ROOT, encoding: 'utf8'});
    assert.equal(r.status, 1, r.stdout + r.stderr); // GitHub's -eo pipefail: the failed pipeline stops the step before exit 3
    assert.match(r.stdout, /1\s+first\s+PASS/);
    assert.match(r.stdout, /2\s+second\s+FAIL\s+1/);
    assert.match(r.stdout, /3\s+third\s+not run/);
    assert.match(r.stdout, /FAIL at step 2 second \("Second"\): exit 1/);
    assert.match(r.stdout, /--from second/);
    assert.throws(() => readFileSync(mark));
    const only = spawnSync(process.execPath, ['scripts/gate-ci.mjs', '--workflow', file, '--any-node', '--only', 'third'], {cwd: ROOT, encoding: 'utf8'});
    assert.equal(only.status, 0, only.stdout + only.stderr);
    assert.match(only.stdout, /1\s+first\s+skipped/);
    readFileSync(mark);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('gate:ci: an interrupt stops only the process group it spawned for the current step', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-ci-'));
  try {
    const file = join(dir, 'ci.yml'), pidFile = join(dir, 'pid');
    writeFileSync(file, `jobs:\n  a:\n    runs-on: x\n    steps:\n      - name: Long\n        run: |\n          sleep 30 &\n          echo $! > ${pidFile}\n          wait\n      - name: After\n        run: echo after\n`);
    const {spawn} = await import('node:child_process');
    const child = spawn(process.execPath, ['scripts/gate-ci.mjs', '--workflow', file, '--any-node'], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    let pid = null;
    for (let k = 0; k < 100 && !pid; k++) { await new Promise(r => setTimeout(r, 50)); try { pid = Number(readFileSync(pidFile, 'utf8')); } catch { /* not yet */ } }
    assert.ok(pid, 'the step started');
    child.kill('SIGTERM');
    const code = await new Promise(r => child.on('exit', r));
    assert.equal(code, 130, out);
    assert.match(out, /STOPPED at step 1 long/);
    assert.match(out, /2\s+after\s+not run/);
    let alive = true;
    for (let k = 0; k < 40 && alive; k++) { try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 50)); } catch { alive = false; } }
    assert.equal(alive, false, 'the step\'s background process was stopped');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
