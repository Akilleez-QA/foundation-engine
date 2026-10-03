// Optional, author-declared restart through the existing scene UI, before a timed active window.
// Uses native input rather than direct state mutation; never drives input inside a measured window or excuses a missing render.
export function activeRestartPlan(row) {
  const plan = row.activeRestart;
  if (plan === undefined) return null;
  if (
    !plan ||
    typeof plan !== 'object' ||
    Array.isArray(plan) ||
    Object.keys(plan).some(k => !['when', 'key', 'timeoutMs'].includes(k)) ||
    typeof plan.when !== 'string' ||
    !plan.when.trim() ||
    plan.when.length > 256 ||
    typeof plan.key !== 'string' ||
    !plan.key.trim() ||
    plan.key.length > 64 ||
    !Number.isInteger(plan.timeoutMs) ||
    plan.timeoutMs < 100 ||
    plan.timeoutMs > 30000
  )
    throw Error(
      `budgets.json scene ${row.id}: activeRestart needs when (CSS selector), key and timeoutMs (100..30000)`,
    );
  if (!row.active) throw Error(`budgets.json scene ${row.id}: activeRestart requires active: true`);
  return {...plan};
}

// Page-side steps run through page.evaluate and page.keyboard only. Playwright's locator, element-handle and
// waitForFunction APIs inject its ~600 KB selector engine into the page, and the bench reads the whole page heap
// (Runtime.getHeapUsage) right after the active window: that harness script and its compiled code once added about
// 1 MiB to every restarted scene's heapMiB (arcade 4.4 -> 5.5 MiB). evaluate and keyboard add nothing that stays.
const MARKER = '__benchRestartMarker';
const POLL_MS = 50;

/** The scene's visible terminal-state marker, kept on the page for the retirement check; false while there is none. */
function holdMarker({scene, when, slot}) {
  const el = document.querySelector(`#app[data-scene="${CSS.escape(scene)}"]`)?.querySelector(when);
  if (!el || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return false;
  window[slot] = el;
  return true;
}
/** Focuses the scene mount, as a native press on it would, so the key reaches the page's own input. */
function focusScene({scene}) {
  document.querySelector(`#app[data-scene="${CSS.escape(scene)}"]`)?.focus?.();
}
const markerRetired = ({slot}) => (window[slot] ? !window[slot].isConnected : false);
const sceneActive = ({scene}) =>
  Boolean(document.querySelector(`#app[data-scene="${CSS.escape(scene)}"][data-scene-state="active"]`));
function releaseMarker({slot}) {
  delete window[slot];
}

export async function restartActiveWindow(
  page,
  row,
  plan,
  {now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms))} = {},
) {
  const start = now();
  const remaining = () => {
    const ms = plan.timeoutMs - (now() - start);
    if (ms <= 0) throw Error(`active restart for ${row.id} exceeded ${plan.timeoutMs} ms`);
    return ms;
  };
  const arg = {scene: row.scene, when: plan.when, slot: MARKER};
  const until = async (fn, what) => {
    for (;;) {
      if (await page.evaluate(fn, arg)) return;
      if (plan.timeoutMs - (now() - start) <= POLL_MS)
        throw Error(`active restart for ${row.id}: ${what} within ${plan.timeoutMs} ms`);
      await sleep(POLL_MS);
    }
  };
  await until(holdMarker, `no visible ${plan.when}`);
  try {
    remaining();
    await page.evaluate(focusScene, arg);
    await page.keyboard.press(plan.key);
    // A still-active old scene is insufficient. Its declared marker must retire before the new visit is measured.
    await until(markerRetired, "the old visit's marker did not retire");
    await until(sceneActive, 'the new visit did not become active');
    return {key: plan.key, when: plan.when, elapsedMs: now() - start, retiredMarker: true};
  } finally {
    await page.evaluate(releaseMarker, arg).catch(() => {});
  }
}

/** Retain every attempt's setup evidence. Preparation runs again before every re-sample, never inside measure. */
export async function sampleAttempts({measure, prepare, resample, retry = () => {}}) {
  const earlier = [],
    preparations = [];
  let sample;
  for (let i = 0; i <= resample; i++) {
    if (prepare) preparations.push(await prepare());
    sample = await measure();
    if (sample.error || sample.classification?.comparable !== false) break;
    earlier.push(`${sample.classification.kind}: ${sample.classification.reasons.join('; ')}`);
    if (i < resample) retry(i + 1);
  }
  if (earlier.length)
    sample = {
      ...sample,
      resampled: earlier.length - (sample.classification?.comparable === false ? 1 : 0),
      earlierAttempts: earlier,
    };
  return preparations.length ? {...sample, preparations} : sample;
}
