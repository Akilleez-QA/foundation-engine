// scripts/play/script-schema.mjs: the play:script file format, checked before any browser starts. Used by
// scripts/play/script.mjs (the CLI and runScript), scripts/play/criteria.ts and lint:brief (npm run check).
// The format is documented in docs/recipes/write-a-playtest-script.md; keep the two in step.

/** The matchers an `expect`, `waitUntil` or `until` takes: exactly one, with a `path` into engine.state(). */
export const MATCHERS = ['equals', 'contains', 'atLeast', 'exists'];

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.length > 0;
const ms = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const positive = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Problems with one matcher (`where` names it in messages). */
export function matcherProblems(e, where) {
  if (!isObject(e)) return [`${where} must be an object like {"path": "world.state.score", "atLeast": 1}`];
  const out = [];
  if (!text(e.path)) out.push(`${where} needs "path", a dotted path into engine.state() such as "world.state.score"`);
  const used = MATCHERS.filter(m => m in e);
  const unknown = Object.keys(e).filter(k => k !== 'path' && !MATCHERS.includes(k));
  for (const k of unknown) out.push(`${where} has an unknown matcher "${k}" (use one of ${MATCHERS.join(', ')})`);
  if (used.length === 0 && unknown.length === 0) out.push(`${where} needs one matcher: ${MATCHERS.join(', ')}`);
  if (used.length > 1) out.push(`${where} has ${used.length} matchers (${used.join(', ')}); use one per step`);
  if ('atLeast' in e && !(typeof e.atLeast === 'number' && Number.isFinite(e.atLeast)))
    out.push(`${where}.atLeast must be a number`);
  if ('exists' in e && typeof e.exists !== 'boolean') out.push(`${where}.exists must be true or false`);
  if ('contains' in e && e.contains === undefined) out.push(`${where}.contains needs a value`);
  return out;
}

/**
 * The steps, by their action key. `args` lists the other keys the step may have, each with its check and what the
 * message says it must be. `value` checks the action key's own value.
 */
export const STEPS = {
  goto: {
    value: [text, 'a scene id'],
    args: {
      params: [v => isObject(v) && Object.values(v).every(x => typeof x === 'string'), 'an object of string values'],
    },
  },
  key: {value: [text, 'a key name such as "ArrowUp"'], args: {ms: [ms, 'milliseconds (0 or more)']}},
  press: {value: [text, 'a key name such as " " or "Enter"'], args: {}},
  teleport: {
    value: [
      v => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n)),
      'an [x, z] pair of numbers',
    ],
    args: {name: [text, 'an entity name']},
  },
  wait: {value: [ms, 'milliseconds (0 or more)'], args: {}},
  snap: {
    value: [v => text(v) && /^[A-Za-z0-9._-]+$/.test(v), 'a file-name-safe label (letters, digits, . _ -)'],
    args: {},
  },
  expect: {matcher: true, args: {}},
  waitUntil: {
    matcher: true,
    args: {ms: [positive, 'a timeout in milliseconds'], every: [positive, 'a poll interval in milliseconds']},
  },
  pressUntil: {
    value: [text, 'a key name'],
    until: true,
    args: {ms: [positive, 'a timeout in milliseconds'], every: [positive, 'a press interval in milliseconds']},
  },
  holdUntil: {
    value: [text, 'a key name'],
    until: true,
    args: {ms: [positive, 'a timeout in milliseconds'], every: [positive, 'a poll interval in milliseconds']},
  },
  reload: {
    value: [v => v === true, 'true'],
    args: {ms: [positive, 'a timeout in milliseconds for the scene to be active again']},
  },
};

/** The action of a valid step (its one key from STEPS). */
export const stepKind = step => Object.keys(STEPS).find(k => k in step);

/** Every problem with a script, as one line each naming the step; an empty list means it can run. */
export function scriptProblems(script) {
  if (!isObject(script)) return ['a script is a JSON object: {"name": "…", "scene": "…", "seed": 1, "steps": [ … ]}'];
  const out = [];
  for (const k of Object.keys(script))
    if (!['name', 'scene', 'seed', 'steps', 'description'].includes(k))
      out.push(`unknown top-level field "${k}" (name, scene, seed, steps, description)`);
  if (!(text(script.name) && /^[A-Za-z0-9._-]+$/.test(script.name)))
    out.push(
      '"name" must be a file-name-safe string (letters, digits, . _ -): evidence goes to playtest/latest/<name>/',
    );
  if (script.scene !== undefined && !text(script.scene)) out.push('"scene" must be a scene id');
  if (script.seed !== undefined && !(Number.isSafeInteger(script.seed) && script.seed >= 0))
    out.push('"seed" must be a whole number, 0 or more');
  if (script.description !== undefined && typeof script.description !== 'string')
    out.push('"description" must be a string');
  if (!Array.isArray(script.steps) || script.steps.length === 0) {
    out.push('"steps" must be a non-empty list');
    return out;
  }
  script.steps.forEach((step, i) => {
    const where = `step ${i + 1}`;
    if (!isObject(step)) {
      out.push(`${where} must be an object such as {"wait": 500}`);
      return;
    }
    const kinds = Object.keys(STEPS).filter(k => k in step);
    if (kinds.length === 0) {
      out.push(`${where} ${JSON.stringify(step)} has no action: use one of ${Object.keys(STEPS).join(', ')}`);
      return;
    }
    if (kinds.length > 1) {
      out.push(`${where} has ${kinds.length} actions (${kinds.join(', ')}); use one per step`);
      return;
    }
    const kind = kinds[0],
      spec = STEPS[kind];
    if (spec.value && !spec.value[0](step[kind]))
      out.push(`${where} (${kind}): ${JSON.stringify(step[kind])} must be ${spec.value[1]}`);
    if (spec.matcher) out.push(...matcherProblems(step[kind], `${where} (${kind})`));
    if (spec.until) {
      if (!('until' in step)) out.push(`${where} (${kind}) needs "until", the matcher that ends it`);
      else out.push(...matcherProblems(step.until, `${where} (${kind}).until`));
    }
    for (const [k, v] of Object.entries(step)) {
      if (k === kind || (k === 'until' && spec.until)) continue;
      const arg = spec.args[k];
      if (!arg) {
        const allowed = [...Object.keys(spec.args), ...(spec.until ? ['until'] : [])];
        out.push(
          `${where} (${kind}) has an unknown field "${k}"${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''}`,
        );
        continue;
      }
      if (!arg[0](v)) out.push(`${where} (${kind}).${k}: ${JSON.stringify(v)} must be ${arg[1]}`);
    }
  });
  return out;
}

/** Throws one error listing every problem, prefixed with the file when given. */
export function assertScript(script, file) {
  const problems = scriptProblems(script);
  if (problems.length)
    throw Object.assign(
      Error(
        `${file ?? 'play:script'}: ${problems.length} problem(s):\n  ${problems.join('\n  ')}\n  (format: docs/recipes/write-a-playtest-script.md)`,
      ),
      {problems},
    );
}
