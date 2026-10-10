#!/usr/bin/env node
// scripts/gate-ci.mjs (`npm run gate:ci`): run locally what .github/workflows/ci.yml runs, so "passes locally" means
// "passes CI". The step list is read from the workflow itself (the single source of truth): every `run:` step, in
// order, with its `env` (workflow, job and step level, plus GitHub's `CI=true`) and GitHub's default shell
// (`bash --noprofile --norc -eo pipefail`). `uses:` steps (checkout, setup-node) are the runner's own setup; the
// `run:` steps listed in SETUP_ONLY are skipped and must be done once by hand (see their reasons). Anything in the
// workflow this runner cannot mirror is an error. It accepts one ordinary job or the explicit browser/two-shard
// graph with a terminal always-running check. Work jobs run serially locally; aggregate results come from those runs;
// scripts/gate-ci.test.mjs fails when the workflow and this runner disagree. Jobs may set different Node versions:
// the first job's is the primary. A step whose job uses another Node major than this process is skipped (a partial
// run, no aggregate) unless --any-node; run those under that Node, e.g. `--only node-current/test` there.
// Hosted job `if` filters (pull request, push, weekly schedule) are accepted for the known jobs and are not
// evaluated here: a full local run still executes every job, and the aggregate requires every one to succeed.
//
//   npm run gate:ci                       every job serially; a failed step stops its job, not independent jobs
//   npm run gate:ci -- --list             the plan (ids, names, env) without running it
//   npm run gate:ci -- --from <step>      resume at a step (id, 1-based number, or name)
//   npm run gate:ci -- --only <step>[,<step>...]   just these steps (the option may repeat)
//   npm run gate:ci -- --any-node         run every step, although the local Node major differs from a job's
//
// Each step runs in its own process group; on Ctrl-C or SIGTERM only that spawned group is signalled (TERM, then
// KILL after 5 s). Browsers stay muted: the steps' own scripts preload scripts/silent-browser.cjs.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  WORK_JOBS,
  AGGREGATE_COMMAND,
  RESULTS_ENV,
  RESULTS_EXPRESSION,
  EVENT_ENV,
  EVENT_EXPRESSION,
} from './ci-results.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WORKFLOW = '.github/workflows/ci.yml';

/** `run:` steps of the workflow that set up the runner rather than check the code, matched on the exact command. */
export const SETUP_ONLY = {
  'npm ci': 'dependency install from the lockfile; run `npm ci` yourself whenever package-lock.json changes',
  'npx --no-install playwright-core install --with-deps chromium':
    'one-time test-browser install (`--with-deps` needs root); run it once per machine',
};
const STEP_KEYS = new Set(['name', 'id', 'run', 'uses', 'with', 'env']);
const JOB_KEYS = new Set(['runs-on', 'timeout-minutes', 'steps', 'env', 'permissions']);
/** Hosted event filters the local runner accepts and does not evaluate. Absent `if` means the job always runs. */
export const JOB_EVENT_IF = {
  browser: "github.event_name != 'schedule'",
  'templates-1': "github.event_name != 'schedule'",
  'templates-2': "github.event_name != 'schedule'",
  'node-current': "github.event_name == 'push' || github.event_name == 'schedule'",
};
const aggregateEnvOk = env => {
  const resultsOnly = {[RESULTS_ENV]: RESULTS_EXPRESSION};
  const withEvent = {[RESULTS_ENV]: RESULTS_EXPRESSION, [EVENT_ENV]: EVENT_EXPRESSION};
  const encoded = JSON.stringify(env);
  return encoded === JSON.stringify(resultsOnly) || encoded === JSON.stringify(withEvent);
};

// ---------- A small YAML subset: block mappings and sequences, plain/quoted scalars, flow lists, | scalars. ----------
const stripComment = s => {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
};
const KEY = /^("[^"]*"|'[^']*'|[^\s"'#:{}[\],&*!|>][^:#]*?):(?:\s+|$)/;
const scalar = (s, where) => {
  s = s.trim();
  if (/^".*"$/.test(s)) return JSON.parse(s);
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(s))
    return s
      .slice(1, -1)
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => scalar(x, where));
  if (/^[&*!{]|^\[/.test(s)) throw Error(`${where}: unsupported YAML (${s}); extend scripts/gate-ci.mjs`);
  return s;
};

/** Parse the YAML subset GitHub workflows here use. Throws on anything else, so nothing is skipped silently. */
export function parseYaml(text) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = raw.map((r, n) => {
    if (/\t/.test(r.match(/^\s*/)[0])) throw Error(`line ${n + 1}: tab indentation`);
    const t = stripComment(r);
    return t.trim() ? {n, indent: t.length - t.trimStart().length, text: t.trim()} : null;
  });
  let i = 0;
  const skip = () => {
    while (i < lines.length && !lines[i]) i++;
  };
  const peek = () => (skip(), lines[i]);

  const block = (indent, header) => {
    // a `|` or `>` scalar of the lines deeper than `indent`
    const out = [];
    let base = -1;
    while (i < raw.length) {
      const r = raw[i];
      if (r.trim() && r.length - r.trimStart().length <= indent) break;
      if (r.trim() && base < 0) base = r.length - r.trimStart().length;
      out.push(r);
      i++;
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();
    const joined = out.map(r => r.slice(Math.max(base, 0))).join('\n');
    return header.endsWith('-') ? joined : joined + '\n';
  };
  const value = (rest, indent, line) => {
    if (/^\|[-+]?$/.test(rest)) {
      i++;
      return block(indent, rest);
    }
    if (/^>/.test(rest)) throw Error(`line ${line.n + 1}: folded scalars (>) are not supported; use |`);
    if (rest) {
      i++;
      return scalar(rest, `line ${line.n + 1}`);
    }
    i++;
    const next = peek();
    if (!next || next.indent < indent || (next.indent === indent && !/^-(\s|$)/.test(next.text))) return null;
    return node(next.indent);
  };
  const mapping = indent => {
    const out = {};
    for (let line = peek(); line && line.indent === indent && !/^-(\s|$)/.test(line.text); line = peek()) {
      const m = line.text.match(KEY);
      if (!m) throw Error(`line ${line.n + 1}: expected "key: value", got ${line.text}`);
      const key = scalar(m[1], `line ${line.n + 1}`);
      if (key in out) throw Error(`line ${line.n + 1}: duplicate key ${key}`);
      out[key] = value(line.text.slice(m[0].length).trim(), indent, line);
    }
    return out;
  };
  const sequence = indent => {
    const out = [];
    for (let line = peek(); line && line.indent === indent && /^-(\s|$)/.test(line.text); line = peek()) {
      const rest = line.text.slice(1).trim(),
        col = indent + line.text.length - line.text.slice(1).trimStart().length;
      if (!rest) {
        i++;
        const next = peek();
        out.push(next && next.indent > indent ? node(next.indent) : null);
      } else if (KEY.test(rest)) {
        lines[i] = {n: line.n, indent: col, text: rest};
        out.push(mapping(col));
      } else {
        i++;
        out.push(scalar(rest, `line ${line.n + 1}`));
      }
    }
    return out;
  };
  const node = indent => (/^-(\s|$)/.test(peek().text) ? sequence(indent) : mapping(indent));
  const first = peek();
  const doc = first ? node(first.indent) : {};
  if (peek()) throw Error(`line ${peek().n + 1}: unexpected indentation`);
  return doc;
}

// ---------- The plan ----------
const slug = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const envMap = (env, where) => {
  if (env == null) return {};
  if (typeof env !== 'object' || Array.isArray(env)) throw Error(`${where}: env must be a mapping`);
  for (const v of Object.values(env))
    if (typeof v !== 'string' || /\$\{\{/.test(v))
      throw Error(`${where}: env value ${v} needs GitHub expressions; extend scripts/gate-ci.mjs`);
  return env;
};

/**
 * The workflow as a plan: `steps` are the `run:` steps gate:ci executes, in order; `setup` the SETUP_ONLY ones;
 * `actions` the `uses:` steps; `node` the primary (first job's) setup-node version and `nodes` each job's.
 * Each step: {n, id, job, aggregate, name, run, env, node}.
 */
export function planFromWorkflow(text) {
  const wf = parseYaml(text);
  const workflowKeys = new Set(['name', 'on', 'permissions', 'concurrency', 'env', 'jobs']);
  for (const key of Object.keys(wf))
    if (!workflowKeys.has(key)) throw Error(`${WORKFLOW}: unsupported workflow key ${key}`);
  const entries = Object.entries(wf.jobs ?? {});
  const graph = entries.length !== 1;
  if (graph) {
    const names = entries.map(([id]) => id);
    if (names.length !== WORK_JOBS.length + 1 || ![...WORK_JOBS, 'check'].every(id => names.includes(id)))
      throw Error(`${WORKFLOW}: unsupported job graph; expected ${[...WORK_JOBS, 'check'].join(', ')}`);
    const aggregate = wf.jobs.check;
    if (
      aggregate.if !== 'always()' ||
      !Array.isArray(aggregate.needs) ||
      aggregate.needs.length !== WORK_JOBS.length ||
      new Set(aggregate.needs).size !== WORK_JOBS.length ||
      WORK_JOBS.some(id => !aggregate.needs.includes(id))
    )
      throw Error(`${WORKFLOW}: check needs every work job exactly once and if: always()`);
    if (aggregate.env) throw Error(`${WORKFLOW}: aggregate job env is unsupported`);
  }
  const jobs = graph ? [...WORK_JOBS, 'check'].map(id => [id, wf.jobs[id]]) : entries;
  if (!jobs.length) throw Error(`${WORKFLOW}: no jobs`);
  const steps = [],
    setup = [],
    actions = [];
  let node = null;
  const nodes = {};
  for (const [jobName, job] of jobs) {
    const aggregate = graph && jobName === 'check';
    const allowed = new Set([...JOB_KEYS, 'if', ...(aggregate ? ['needs'] : [])]);
    for (const k of Object.keys(job))
      if (!allowed.has(k))
        throw Error(`${WORKFLOW}: job ${jobName} key "${k}" cannot be mirrored locally; extend scripts/gate-ci.mjs`);
    if (!aggregate && Object.hasOwn(job, 'if') && JOB_EVENT_IF[jobName] !== job.if)
      throw Error(`${WORKFLOW}: job ${jobName} if cannot be mirrored locally; extend scripts/gate-ci.mjs`);
    if (graph && job['runs-on'] !== 'ubuntu-latest') throw Error(`${WORKFLOW}: supported graph requires ubuntu-latest`);
    for (const [key, value] of Object.entries(job))
      if (key !== 'steps' && JSON.stringify(value).includes('${{'))
        throw Error(`${WORKFLOW}: job ${jobName} ${key} needs unsupported GitHub expressions`);
    const base = {...envMap(wf.env, 'workflow'), ...envMap(job.env, `job ${jobName}`)};
    if (!Array.isArray(job.steps) || !job.steps.length) throw Error(`${WORKFLOW}: job ${jobName} needs steps`);
    let jobRuns = 0;
    for (const [k, s] of job.steps.entries()) {
      const where = `${WORKFLOW}: job ${jobName} step ${k + 1}${s?.name ? ` (${s.name})` : ''}`;
      if (!s || typeof s !== 'object') throw Error(`${where}: not a mapping`);
      for (const key of Object.keys(s))
        if (!STEP_KEYS.has(key))
          throw Error(`${where}: key "${key}" cannot be mirrored locally; extend scripts/gate-ci.mjs`);
      if (s.uses && s.run) throw Error(`${where}: both uses and run`);
      if (s.uses) {
        if (!/^actions\/(checkout|setup-node)@[^\s]+$/.test(s.uses) || JSON.stringify(s).includes('${{'))
          throw Error(`${where}: unsupported action or GitHub expressions`);
        actions.push(s.uses);
        if (/^actions\/setup-node@/.test(s.uses)) {
          const version = String(s.with?.['node-version'] ?? '');
          if (!/^\d+(?:\.\d+){0,2}$/.test(version) || (nodes[jobName] && nodes[jobName] !== version))
            throw Error(`${where}: inconsistent or unsupported Node version`);
          nodes[jobName] = version;
          node ??= version;
        }
        continue;
      }
      if (typeof s.run !== 'string' || !s.run.trim()) throw Error(`${where}: no run command`);
      const run = s.run.trim();
      if (run.includes('${{')) throw Error(`${where}: run needs GitHub expressions; extend scripts/gate-ci.mjs`);
      if (aggregate) {
        if (run !== AGGREGATE_COMMAND || !aggregateEnvOk(s.env))
          throw Error(`${where}: unsupported aggregate command or result binding`);
      }
      const stepEnv = aggregate ? {} : envMap(s.env, where);
      if (run in SETUP_ONLY) {
        setup.push({job: jobName, name: s.name ?? run, run, reason: SETUP_ONLY[run]});
        continue;
      }
      jobRuns++;
      const scripts = [...run.matchAll(/\bnpm run(?: -s| --silent)? ([\w:.-]+)/g)].map(m => m[1]);
      const name = s.name ?? run.split('\n')[0];
      const id = !run.includes('\n') && new Set(scripts).size === 1 ? scripts[0] : slug(name);
      steps.push({
        n: steps.length + 1,
        id: graph ? `${jobName}/${id}` : id,
        job: jobName,
        aggregate,
        name,
        run,
        env: {...base, ...stepEnv},
        node: nodes[jobName] ?? null,
      });
    }
    if (!jobRuns || (aggregate && jobRuns !== 1))
      throw Error(
        `${WORKFLOW}: job ${jobName} needs ${aggregate ? 'exactly one aggregate' : 'at least one checking'} run step`,
      );
  }
  const ids = steps.map(s => s.id);
  for (const s of steps)
    if (ids.indexOf(s.id) !== ids.lastIndexOf(s.id)) s.id = (graph ? s.job + '/' : '') + slug(s.name);
  if (new Set(steps.map(s => s.id)).size !== steps.length)
    throw Error(`${WORKFLOW}: two steps share an id; give them distinct names`);
  return {steps, setup, actions, node, nodes, graph};
}

/** The step a --from/--only argument names: its id, its 1-based number, its name, or its name's slug. */
export function findStep(steps, ref) {
  const r = String(ref).trim().toLowerCase();
  const matches = steps.filter(
    s => s.id.toLowerCase() === r || String(s.n) === r || s.name.toLowerCase() === r || slug(s.name) === slug(r),
  );
  if (matches.length > 1) throw Error(`gate:ci: ambiguous step "${ref}"; use a job-qualified id`);
  const hit = matches[0];
  if (!hit) throw Error(`gate:ci: no step "${ref}"; steps: ${steps.map(s => s.id).join(', ')}`);
  return hit;
}

/** Apply --from / --only to the plan. */
export function selectSteps(steps, {from, only = []}) {
  if (from && only.length) throw Error('gate:ci: use --from or --only, not both');
  if (only.length) {
    const want = new Set(only.map(o => findStep(steps, o)));
    return steps.filter(s => want.has(s));
  }
  return from ? steps.slice(steps.indexOf(findStep(steps, from))) : steps;
}

export function parseArgs(argv) {
  const o = {only: [], list: false, anyNode: false, from: null, workflow: WORKFLOW};
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k],
      next = () => {
        if (k + 1 >= argv.length) throw Error(`gate:ci: ${a} needs a value`);
        return argv[++k];
      };
    if (a === '--from') o.from = next();
    else if (a === '--only') o.only.push(...next().split(',').filter(Boolean));
    else if (a === '--list') o.list = true;
    else if (a === '--any-node') o.anyNode = true;
    else if (a === '--workflow') o.workflow = next();
    else throw Error(`gate:ci: unknown option ${a}`);
  }
  return o;
}

const fmt = s => (s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const pad = (s, w) => String(s).padEnd(w);

function table(rows) {
  const w = [3, Math.max(4, ...rows.map(r => r.id.length)), Math.max(7, ...rows.map(r => r.result.length)), 4];
  const line = cells =>
    cells
      .map((c, k) => pad(c, w[k] ?? 0))
      .join('  ')
      .trimEnd();
  console.log('\n' + line(['#', 'step', 'result', 'exit', 'time']));
  for (const r of rows) console.log(line([r.n, r.id, r.result, r.code ?? '', r.s == null ? '' : fmt(r.s)]));
}

/** Run one step in its own process group; resolves with its exit status. */
function runStep(step, state) {
  return new Promise(done => {
    const child = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run], {
      cwd: ROOT,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      env: {...process.env, CI: 'true', ...step.env},
    });
    state.child = child;
    child.on('error', e => {
      state.child = null;
      console.error(`gate:ci: cannot start bash: ${e.message}`);
      done({code: 127});
    });
    child.on('exit', (code, signal) => {
      state.child = null;
      done({code: code ?? (signal ? 128 + ({SIGINT: 2, SIGKILL: 9, SIGTERM: 15}[signal] ?? 0) : 1), signal});
    });
  });
}

/** Signal only the process group this runner spawned for the current step. */
function stopChild(state, signal) {
  const child = state.child;
  if (!child?.pid) return;
  const kill = sig => {
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, sig);
    } catch {
      /* already gone */
    }
  };
  kill(signal);
  setTimeout(() => {
    if (state.child === child) kill('SIGKILL');
  }, 5000).unref();
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  const plan = planFromWorkflow(readFileSync(resolve(ROOT, o.workflow), 'utf8'));
  let partial = Boolean(o.from || o.only.length);
  let chosen = selectSteps(plan.steps, o).filter(s => !partial || !s.aggregate);
  if (!chosen.length) throw Error('gate:ci: no executable steps; a partial selection cannot run the aggregate');
  if (o.list) {
    for (const s of plan.setup) console.log(`setup (not run): ${s.name}: ${s.reason}`);
    for (const s of plan.steps)
      console.log(
        `${pad(s.n, 3)} ${pad(s.id, 34)} ${s.name}${Object.keys(s.env).length ? '  env ' + JSON.stringify(s.env) : ''}`,
      );
    return 0;
  }
  const major = process.versions.node.split('.')[0];
  const otherNode = chosen.filter(s => !s.aggregate && s.node && s.node.split('.')[0] !== major);
  const otherNodeSkipped = new Set();
  if (otherNode.length) {
    const versions = [...new Set(otherNode.map(s => s.node))].join(', ');
    const msg = `gate:ci: CI uses Node ${versions} for ${otherNode.length} selected step(s), this is Node ${process.versions.node}`;
    if (o.anyNode) console.warn(`${msg} (--any-node: results may differ from CI).`);
    else if (
      otherNode.some(s => s.node === plan.node) ||
      otherNode.length === chosen.filter(s => !s.aggregate).length
    ) {
      console.error(`${msg}; run it with that Node (or pass --any-node to accept the difference).`);
      return 2;
    } else {
      // Primary-Node steps run here; another job's Node is reproduced only under that Node.
      for (const s of otherNode) otherNodeSkipped.add(s);
      partial = true;
      chosen = chosen.filter(s => !otherNodeSkipped.has(s) && !s.aggregate);
      console.warn(
        `${msg}; skipping them (a partial run). Under that Node: npm run gate:ci -- --only ${otherNode.map(s => s.id).join(',')}`,
      );
    }
  }
  console.log(
    `gate:ci: ${chosen.length} of ${plan.steps.length} step(s) from ${o.workflow}. Not run here (do them once yourself): ${plan.setup.map(s => s.run).join('; ') || 'none'}.`,
  );

  const state = {child: null, stop: null};
  const onSignal = sig => {
    state.stop = sig;
    console.error(`\ngate:ci: ${sig}: stopping the current step`);
    stopChild(state, 'SIGTERM');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const t0 = Date.now(),
    rows = plan.steps.map(s => ({
      n: s.n,
      id: s.id,
      result: chosen.includes(s) ? 'not run' : otherNodeSkipped.has(s) ? `skipped (Node ${s.node})` : 'skipped',
    }));
  let failed = null;
  const failedJobs = new Set();
  try {
    for (const step of chosen) {
      const row = rows[step.n - 1];
      if (failedJobs.has(step.job)) continue;
      if (step.aggregate) {
        const results = Object.fromEntries(
          WORK_JOBS.map(job => {
            const owned = plan.steps.filter(s => s.job === job).map(s => rows[s.n - 1]);
            const result = owned.every(r => r.result === 'PASS')
              ? 'success'
              : owned.some(r => r.result === 'stopped')
                ? 'cancelled'
                : owned.some(r => r.result === 'FAIL')
                  ? 'failure'
                  : 'skipped';
            return [job, {result}];
          }),
        );
        step.env = {...step.env, [RESULTS_ENV]: JSON.stringify(results)};
      }
      console.log(`\n=== gate:ci [${step.n}/${plan.steps.length}] ${step.id}: ${step.name} ===`);
      const t = Date.now(),
        r = await runStep(step, state);
      Object.assign(row, {
        code: r.code,
        s: (Date.now() - t) / 1000,
        result: state.stop ? 'stopped' : r.code === 0 ? 'PASS' : 'FAIL',
      });
      if (r.code !== 0 || state.stop) {
        failed ??= {step, ...row};
        failedJobs.add(step.job);
        if (state.stop || !plan.graph) break;
      }
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  table(rows);
  const total = fmt((Date.now() - t0) / 1000);
  if (!failed) {
    console.log(
      `gate:ci: ${partial ? 'PARTIAL PASS (not full CI acceptance)' : 'PASS'} (${chosen.length} step(s)) in ${total}`,
    );
    return 0;
  }
  console.log(
    `gate:ci: ${failed.result === 'stopped' ? 'STOPPED' : 'FAIL'} at step ${failed.step.n} ${failed.step.id} ("${failed.step.name}"): exit ${failed.code} after ${fmt(failed.s)}; total ${total}`,
  );
  console.log(`gate:ci: rerun from here: npm run gate:ci -- --from ${failed.step.id}`);
  return state.stop ? 130 : failed.code || 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    code => {
      process.exitCode = code;
    },
    e => {
      console.error(e.message);
      process.exitCode = 2;
    },
  );
}
