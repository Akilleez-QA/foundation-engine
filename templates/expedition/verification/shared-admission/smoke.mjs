// Run from the repository root after generating the expedition template:
// GAME_DIR=templates/expedition/game node templates/expedition/verification/shared-admission/smoke.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve, open } from '../../../../scripts/play/lib.mjs';
import { launch } from '../../../../scripts/perf/bench-browser.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));
process.env.GAME_DIR ??= 'templates/expedition/game';
mkdirSync(dir, { recursive: true });
const samples = [];
let server, browser;
const evidence = { viewport: { width: 390, height: 844 }, cycles: 5, samples, errors: [] };
try {
  server = await serve();
  browser = await launch({ ...evidence.viewport, mobile: true });
  evidence.browser = browser.version;
  evidence.launchArguments = browser.launchArguments;
  await open(browser, server.url, 'field');

  async function sample(scene, visit) {
    const key = scene === 'field' ? 'doorway' : 'shelter';
    await browser.page.waitForFunction(({ scene, key }) => {
      const snapshot = window.engine.state();
      const owned = snapshot.world?.state?.[key];
      return snapshot.scene?.scene === `scene.${scene}` && snapshot.scene.state === 'active'
        && owned?.sharedPinnedBytes === 208 && owned.sharedOwners === 1
        && (key === 'doorway' ? owned.ready : owned.contactReady);
    }, { scene, key }, { timeout: 15000 });
    const snapshot = await browser.evaluate('window.engine.state()');
    const owned = snapshot.world.state[key];
    assert.equal(owned.sharedPinnedBytes, 208, `${scene}: leaked byte reservation`);
    assert.equal(owned.sharedOwners, 1, `${scene}: leaked owner`);
    samples.push({ visit, scene, epoch: snapshot.scene.epoch, ownership: owned });
    assert.equal(browser.errors.length, 0, browser.errors.join('\n'));
  }

  await sample('field', 0);
  await browser.page.screenshot({ path: `${dir}/phone-field.png` });
  for (let visit = 1; visit <= evidence.cycles; visit++) {
    // Exercise the real router/preflight seam. Gameplay completion is covered by the
    // separate touch/reload script; this diagnostic isolates repeated ownership.
    const entered = await browser.evaluate('window.engine.goto("shelter")');
    assert.equal(entered.state, 'active');
    await sample('shelter', visit);
    if (visit === 1) await browser.page.screenshot({ path: `${dir}/phone-shelter.png` });
    // Use the actual touch return control, not a synthetic direct scene mutation.
    await browser.page.getByRole('button', { name: 'Return to field', exact: true }).tap();
    await sample('field', visit);
  }
  await browser.page.screenshot({ path: `${dir}/phone-returned.png` });
  evidence.errors = [...browser.errors];
  evidence.passed = true;
  console.log(JSON.stringify(evidence));
} catch (error) {
  evidence.errors = [...(browser?.errors ?? []), String(error?.stack ?? error)];
  evidence.passed = false;
  throw error;
} finally {
  writeFileSync(`${dir}/smoke.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  await browser?.close();
  await server?.close();
}
