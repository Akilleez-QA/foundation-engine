// Optional, author-declared restart through the existing scene UI, before a timed active window.
// Uses native input rather than direct state mutation; never drives input inside a measured window or excuses a missing render.
export function activeRestartPlan(row) {
  const plan = row.activeRestart;
  if (plan === undefined) return null;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).some(k => !['when', 'key', 'timeoutMs'].includes(k)) ||
      typeof plan.when !== 'string' || !plan.when.trim() || plan.when.length > 256 ||
      typeof plan.key !== 'string' || !plan.key.trim() || plan.key.length > 64 ||
      !Number.isInteger(plan.timeoutMs) || plan.timeoutMs < 100 || plan.timeoutMs > 30000)
    throw Error(`budgets.json scene ${row.id}: activeRestart needs when (CSS selector), key and timeoutMs (100..30000)`);
  if (!row.active) throw Error(`budgets.json scene ${row.id}: activeRestart requires active: true`);
  return {...plan};
}

export async function restartActiveWindow(page, row, plan, {now = Date.now} = {}) {
  const start = now();
  const remaining = () => {
    const ms = plan.timeoutMs - (now() - start);
    if (ms <= 0) throw Error(`active restart for ${row.id} exceeded ${plan.timeoutMs} ms`);
    return ms;
  };
  const scene = page.locator(`#app[data-scene="${row.scene}"]`);
  const marker = scene.locator(plan.when).first();
  await marker.waitFor({state: 'visible', timeout: remaining()});
  const old = await marker.elementHandle({timeout: remaining()});
  if (!old) throw Error(`active restart for ${row.id}: readiness marker disappeared before input`);
  try {
    await scene.press(plan.key, {timeout: remaining()});
    // A still-active old scene is insufficient. Its declared marker must retire before the new visit is measured.
    await page.waitForFunction(element => !element.isConnected, old, {timeout: remaining()});
    await page.locator(`#app[data-scene="${row.scene}"][data-scene-state="active"]`).waitFor({state: 'attached', timeout: remaining()});
    return {key: plan.key, when: plan.when, elapsedMs: now() - start, retiredMarker: true};
  } finally { await old.dispose(); }
}

/** Retain every attempt's setup evidence. Preparation runs again before every re-sample, never inside measure. */
export async function sampleAttempts({measure, prepare, resample, retry = () => {}}) {
  const earlier = [], preparations = [];
  let sample;
  for (let i = 0; i <= resample; i++) {
    if (prepare) preparations.push(await prepare());
    sample = await measure();
    if (sample.error || sample.classification?.comparable !== false) break;
    earlier.push(`${sample.classification.kind}: ${sample.classification.reasons.join('; ')}`);
    if (i < resample) retry(i + 1);
  }
  if (earlier.length) sample = {...sample, resampled: earlier.length - (sample.classification?.comparable === false ? 1 : 0), earlierAttempts: earlier};
  return preparations.length ? {...sample, preparations} : sample;
}
