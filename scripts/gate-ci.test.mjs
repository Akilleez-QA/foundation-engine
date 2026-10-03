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
  assert.ok(ids.includes('browser/test:ui-browser') && ids.includes('templates-1/gate:templates') && ids.includes('templates-2/gate:templates'));
  assert.deepEqual(plan.steps.filter(s => s.job === 'node-current').map(s => s.run), ['npm run test', 'npm run check'], 'the newest-Node job stays cheap: tests and the quick check, no browser');
  assert.equal(plan.steps.filter(s => s.aggregate).length, 1);
  assert.ok(plan.steps.some(s => /GAME_DIR=templates\/expedition\/game npm run test:framework-browser/.test(s.run)));
  assert.equal(plan.node, '22');
  const newest = Number(plan.nodes['node-current']);
  assert.ok(newest >= 26, 'one job tests the newest Node major');
  assert.deepEqual(Object.entries(plan.nodes).filter(([job]) => job !== 'node-current').map(([, v]) => v), ['22', '22', '22', '22']);
  const parsed = parseYaml(ci);
  assert.deepEqual(parsed.permissions, {contents: 'read'});
  for (const id of ['browser','templates-1','templates-2']) {
    assert.equal(parsed.jobs[id]['timeout-minutes'], '30');
    assert.deepEqual(parsed.jobs[id].steps.slice(0,4), parsed.jobs.browser.steps.slice(0,4), 'each runner retains identical pinned setup');
  }
  assert.deepEqual(parsed.jobs.check.needs, ['browser','templates-1','templates-2','node-current']);
  assert.equal(parsed.jobs.check.if, 'always()');
  // Same order as the workflow.
  const order = [...ci.matchAll(/run: (?:GAME_DIR=\S+ )?npm run (?:-s )?([\w:.-]+)/g)].map(m => m[1]);
  assert.deepEqual(plan.steps.filter(s => s.job === 'browser').map(s => s.id.split('/')[1]), order.filter(id => !['gate:templates', 'test', 'check'].includes(id)));
  assert.deepEqual(plan.steps.filter(s => s.job.startsWith('templates-')).map(s => s.run), ['npm run gate:templates -- --shard 1/2 --phone', 'npm run gate:templates -- --shard 2/2 --phone']);
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
  assert.throws(() => planFromWorkflow(wf('  b:\n    runs-on: x\n')), /unsupported job graph/);
  assert.throws(() => planFromWorkflow(wf('        env:\n          T: ${{ secrets.X }}\n')), /GitHub expressions/);
  assert.throws(() => parseYaml('a: >\n  folded\n'), /folded/);
});

test('gate:ci: --from and --only select steps by id, number or name', () => {
  const {steps} = planFromWorkflow(ci);
  assert.equal(selectSteps(steps, {from: 'templates-1/gate:templates'})[0].id, 'templates-1/gate:templates');
  assert.deepEqual(selectSteps(steps, {only: ['2', 'Complete template shard 1 of 2, including phone smoke']}).map(s => s.id), ['browser/test:diagnostics-browser', 'templates-1/gate:templates']);
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

const graphWorkflow = (browser = 'echo browser', first = 'echo first', second = 'echo second', current = 'echo current', nodes = '') => `jobs:
  browser:
    runs-on: ubuntu-latest
    steps:${nodes && `
      - uses: actions/setup-node@abc
        with:
          node-version: ${nodes.split(',')[0]}`}
      - run: ${browser}
  templates-1:
    runs-on: ubuntu-latest
    steps:
      - run: ${first}
  templates-2:
    runs-on: ubuntu-latest
    steps:
      - run: ${second}
  node-current:
    runs-on: ubuntu-latest
    steps:${nodes && `
      - uses: actions/setup-node@abc
        with:
          node-version: ${nodes.split(',')[1]}`}
      - run: ${current}
  check:
    needs: [browser, templates-1, templates-2, node-current]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Aggregate
        env:
          CI_JOB_RESULTS: \${{ toJSON(needs) }}
        run: node scripts/ci-results.mjs
`;

test('bounded graph rejects missing dependencies, alternate conditions, aggregate changes and expressions', () => {
  const good = graphWorkflow();
  assert.equal(planFromWorkflow(good).steps.length, 5);
  for (const [before, after] of [
    ['needs: [browser, templates-1, templates-2, node-current]', 'needs: [browser, templates-1, templates-2]'],
    ['needs: [browser, templates-1, templates-2, node-current]', 'needs: [browser, templates-1, templates-2, templates-1]'],
    ['  node-current:', '  newest-node:'],
    ['if: always()', 'if: success()'],
    ['    if: always()\n', ''],
    ['node scripts/ci-results.mjs', 'echo success'],
    ['toJSON(needs)', 'toJSON(github)'],
    ['      - run: echo first', '      - run: echo first\n        if: always()'],
    ['      - run: echo second', '      - run: echo $' + '{{ secrets.X }}'],
    ['  templates-2:', '  missing-shard:'],
    ['  browser:\n', '  browser:\n    needs: [templates-1]\n'],
    ['    runs-on: ubuntu-latest', '    runs-on: $' + '{{ matrix.os }}'],
    ['jobs:', 'defaults:\n  run:\n    shell: sh\njobs:'],
    ['      - run: echo first', '      - run: npm ci\n        env:\n          SECRET: $' + '{{ secrets.X }}'],
  ]) assert.throws(() => planFromWorkflow(good.replace(before, after)), undefined, after);
});

test('local graph executes independent jobs after failure and derives a refusing aggregate; partial runs are explicit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-ci-graph-'));
  try {
    const file = join(dir, 'ci.yml'), skipped = join(dir, 'must-not-exist');
    writeFileSync(file, graphWorkflow(`false\n      - run: touch ${skipped}`,  'echo FIRST_EXECUTED', 'echo SECOND_EXECUTED'));
    const run = args => spawnSync(process.execPath, ['scripts/gate-ci.mjs', '--workflow', file, '--any-node', ...args], {cwd: ROOT, encoding:'utf8'});
    const failed = run([]), output = failed.stdout + failed.stderr;
    assert.equal(failed.status, 1, output);
    assert.match(output, /FIRST_EXECUTED/); assert.match(output, /SECOND_EXECUTED/);
    assert.throws(() => readFileSync(skipped), 'later steps of a failed job are not run');
    assert.match(output, /unsuccessful jobs: browser=failure/);
    assert.match(output, /check\/aggregate\s+FAIL/);
    const partial = run(['--only','templates-1/echo-first-executed']);
    assert.equal(partial.status, 0, partial.stderr); assert.match(partial.stdout, /PARTIAL PASS \(not full CI acceptance\)/);
    assert.doesNotMatch(partial.stdout, /check: every work job succeeded/);
    assert.match(partial.stdout, /check\/aggregate\s+skipped/);
    const aggregateOnly = run(['--only','check/aggregate']); assert.equal(aggregateOnly.status, 2);
    writeFileSync(file, graphWorkflow()); const passed = run([]);
    assert.equal(passed.status, 0, passed.stdout + passed.stderr); assert.match(passed.stdout, /check: every work job succeeded/);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('per-job Node: other-Node steps are skipped as a partial run, run under that Node, or with --any-node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-ci-node-'));
  try {
    const here = process.versions.node.split('.')[0], other = String(Number(here) + 1), file = join(dir, 'ci.yml');
    const run = args => spawnSync(process.execPath, ['scripts/gate-ci.mjs', '--workflow', file, ...args], {cwd: ROOT, encoding: 'utf8'});
    const text = graphWorkflow('echo BROWSER_RAN', 'echo first', 'echo second', 'echo CURRENT_RAN', `${here},${other}`);
    assert.deepEqual(planFromWorkflow(text).nodes, {browser: here, 'node-current': other});
    assert.equal(planFromWorkflow(text).node, here, 'the first job sets the primary Node');
    writeFileSync(file, text);
    const skipped = run([]);
    assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
    assert.match(skipped.stdout, /BROWSER_RAN/); assert.doesNotMatch(skipped.stdout, /CURRENT_RAN/);
    assert.match(skipped.stdout, new RegExp(`node-current/echo-current-ran\\s+skipped \\(Node ${other}\\)`));
    assert.match(skipped.stdout, /PARTIAL PASS \(not full CI acceptance\)/);
    assert.doesNotMatch(skipped.stdout, /check: every work job succeeded/, 'no aggregate without every job');
    assert.match(skipped.stderr, /--only node-current\/echo-current-ran/);
    assert.equal(run(['--only', 'node-current/echo-current-ran']).status, 2, 'only other-Node steps: run them under that Node');
    const any = run(['--any-node']);
    assert.equal(any.status, 0, any.stdout + any.stderr); assert.match(any.stdout, /CURRENT_RAN/); assert.match(any.stdout, /check: every work job succeeded/);
    writeFileSync(file, graphWorkflow(undefined, undefined, undefined, undefined, `${other},${here}`));
    assert.equal(run([]).status, 2, 'a primary-Node mismatch still refuses');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
