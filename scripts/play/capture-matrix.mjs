#!/usr/bin/env node
/** Optional creator-authored browser captures and bounded interactions; task acceptance remains unverified. */
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ROOT, serve, open} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';

export function validateMatrix(value) {
  const errors = [];
  const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const id = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(v);
  const names = new Set(), cases = new Set();
  if (!object(value) || value.version !== 1) errors.push('version must be 1');
  if (!Array.isArray(value?.profiles)) errors.push('profiles must be an array');
  else for (const [i, p] of value.profiles.entries()) {
    const at = `profiles[${i}]`;
    if (!object(p)) { errors.push(`${at} must be an object`); continue; }
    if (!id(p.id) || names.has(p.id)) errors.push(`${at}.id must be a unique path-safe identifier`);
    else names.add(p.id);
    if (!object(p.viewport) || !['width','height'].every(k => Number.isSafeInteger(p.viewport[k]) && p.viewport[k] > 0)) errors.push(`${at}.viewport requires positive integer width and height`);
    for (const k of ['hasTouch','isMobile']) if (p[k] !== undefined && typeof p[k] !== 'boolean') errors.push(`${at}.${k} must be boolean`);
    if (p.deviceScaleFactor !== undefined && (!Number.isFinite(p.deviceScaleFactor) || p.deviceScaleFactor <= 0)) errors.push(`${at}.deviceScaleFactor must be finite and positive`);
    if (!['supported','experimental','unsupported'].includes(p.support)) errors.push(`${at}.support must be supported, experimental or unsupported`);
    if (!Array.isArray(p.inputs) || !p.inputs.length || Array.from(p.inputs).some(k => !['keyboard','pointer','touch','gamepad'].includes(k)) || new Set(p.inputs).size !== p.inputs.length) errors.push(`${at}.inputs must list distinct declared input kinds`);
    if (p.graphicsQuery !== undefined && (!object(p.graphicsQuery) || Object.entries(p.graphicsQuery).some(([k,v]) => !text(k) || !text(v) || ['flags','seed'].includes(k)))) errors.push(`${at}.graphicsQuery must contain nonempty string query values; flags and seed are reserved`);
  }
  if (!Array.isArray(value?.cases)) errors.push('cases must be an array');
  else for (const [i, c] of value.cases.entries()) {
    const at = `cases[${i}]`;
    if (!object(c)) { errors.push(`${at} must be an object`); continue; }
    if (!id(c.id) || cases.has(c.id)) errors.push(`${at}.id must be a unique path-safe identifier`);
    else cases.add(c.id);
    if (!names.has(c.profile)) errors.push(`${at}.profile must reference a declared profile`);
    if (!id(c.scene)) errors.push(`${at}.scene must be a path-safe scene identifier`);
    if (!text(c.task)) errors.push(`${at}.task must describe intended acceptance work`);
    if (!Array.isArray(c.criteria) || !c.criteria.length || Array.from(c.criteria).some(v => !text(v))) errors.push(`${at}.criteria must contain nonempty descriptions`);
    if (c.steps !== undefined) {
      if (!Array.isArray(c.steps) || c.steps.length > 64) errors.push(`${at}.steps must be an array of at most 64 steps`);
      else for (const [j, step] of c.steps.entries()) {
        const where = `${at}.steps[${j}]`, profile = Array.isArray(value.profiles) ? value.profiles.find(p => p?.id === c.profile) : undefined;
        if (!object(step)) { errors.push(`${where} must be an object`); continue; }
        const operations = ['click', 'tap', 'key', 'waitFor'].filter(k => k in step);
        if (operations.length !== 1 || Object.keys(step).some(k => ![...operations, 'timeoutMs'].includes(k))) {
          errors.push(`${where} requires exactly one click, tap, key or waitFor operation`); continue;
        }
        const operation = operations[0];
        if (step.timeoutMs !== undefined && (!Number.isSafeInteger(step.timeoutMs) || step.timeoutMs < 1 || step.timeoutMs > 10000 || operation === 'key')) errors.push(`${where}.timeoutMs must be 1–10000 for locator operations`);
        if (operation === 'waitFor') {
          if (!object(step.waitFor) || !text(step.waitFor.selector) || step.waitFor.selector.length > 512 || !['visible', 'hidden'].includes(step.waitFor.state) || Object.keys(step.waitFor).some(k => !['selector','state'].includes(k))) errors.push(`${where}.waitFor requires selector and visible/hidden state`);
        } else {
          if (!text(step[operation]) || step[operation].length > (operation === 'key' ? 80 : 512)) errors.push(`${where}.${operation} must be bounded nonempty text`);
          const input = {click:'pointer',tap:'touch',key:'keyboard'}[operation];
          if (!Array.isArray(profile?.inputs) || !profile.inputs.includes(input)) errors.push(`${where}.${operation} requires declared ${input} input`);
          if (operation === 'tap' && profile?.hasTouch !== true) errors.push(`${where}.tap requires hasTouch: true`);
        }
      }
    }
  }
  return errors;
}

export async function captureMatrix(manifest, {out, revision, workingTreeDirty = null, signal, seed = 1} = {}, dependencies = {}) {
  const problems = validateMatrix(manifest);
  if (problems.length) throw new Error(`Invalid capture matrix:\n${problems.join('\n')}`);
  if (!out || typeof revision !== 'string' || !revision.trim()) throw new Error('capture requires out and revision');
  // Detach before any external work; mutation of the authored manifest cannot retarget an active run.
  const input = JSON.parse(JSON.stringify(manifest));
  const io = {serve, open, launch, ...dependencies};
  await mkdir(join(out,'artifacts'), {recursive:true});
  const report = {version:1, revision, workingTreeDirty, seed, startedAt:new Date().toISOString(), environment:'browser-emulation',
    limitations:['Step completion, screenshots and probes do not verify declared task/criteria, usability or physical input behavior.',
      'No physical hardware, sustained timing, thermal, safe-inset or hand-obstruction certification.'], cases:[], errors:[]};
  const save = () => writeFile(join(out,'report.json'), JSON.stringify(report,null,2)+'\n');
  let server;
  try {
    for (const c of input.cases) {
      const profile = input.profiles.find(p => p.id === c.profile);
      const row = {id:c.id, scene:c.scene, profile, task:c.task,
        acceptance:{status:'unverified', criteria:c.criteria.map(description => ({description,status:'unverified'}))},
        capture:{status:'pending'}, environment:{kind:'browser-emulation'}};
      report.cases.push(row);
      if (profile.support === 'unsupported') { row.capture = {status:'skipped',reason:'Creator declared this profile unsupported'}; await save(); continue; }
      if (signal?.aborted) { row.capture = {status:'cancelled',reason:'Capture run aborted before this case'}; await save(); continue; }
      let b;
      try {
        signal?.throwIfAborted();
        server ??= await io.serve();
        signal?.throwIfAborted();
        b = await io.launch({...profile.viewport, hasTouch:profile.hasTouch ?? false, isMobile:profile.isMobile ?? false, deviceScaleFactor:profile.deviceScaleFactor ?? 1, strictClose:true});
        signal?.throwIfAborted();
        row.environment = {kind:'browser-emulation', browser:b.version, executable:b.executable, arguments:b.launchArguments};
        const consoleLines = await io.open(b, server.url, c.scene, {seed,query:profile.graphicsQuery ?? {}});
        signal?.throwIfAborted();
        if (c.steps) {
          row.steps = [];
          for (const step of c.steps) {
            signal?.throwIfAborted();
            const result = {step, status:'pending'};
            row.steps.push(result);
            try {
              const timeout = step.timeoutMs ?? 5000;
              if ('click' in step) await b.page.locator(step.click).click({timeout});
              else if ('tap' in step) await b.page.locator(step.tap).tap({timeout});
              else if ('key' in step) await b.page.keyboard.press(step.key);
              else await b.page.locator(step.waitFor.selector).waitFor({state:step.waitFor.state,timeout});
              signal?.throwIfAborted();
              result.status = 'completed';
            } catch (error) {
              result.status = signal?.aborted ? 'cancelled' : 'failed';
              result.error = String(error);
              throw error;
            }
          }
        }
        const probe = await b.evaluate('({state: window.engine.state(), probes: Object.fromEntries(window.engine.probes().map(name => [name, window.engine.probe(name)])), viewport: {width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio}, maxTouchPoints: navigator.maxTouchPoints})');
        signal?.throwIfAborted();
        await writeFile(join(out,'artifacts',`${c.id}.json`),JSON.stringify({revision,case:c.id,profile,probe,errors:b.errors,console:consoleLines},null,2)+'\n');
        signal?.throwIfAborted();
        const screenshot = await b.page.screenshot({type:'png'});
        signal?.throwIfAborted();
        await writeFile(join(out,'artifacts',`${c.id}.png`),screenshot);
        signal?.throwIfAborted();
        const mismatches = [];
        for (const key of ['width','height']) if (probe.viewport?.[key] !== profile.viewport[key]) mismatches.push(`Observed ${key} differs from requested viewport`);
        if (probe.viewport?.deviceScaleFactor !== (profile.deviceScaleFactor ?? 1)) mismatches.push('Observed DPR differs from requested DPR');
        if (typeof probe.maxTouchPoints !== 'number' || (probe.maxTouchPoints > 0) !== (profile.hasTouch ?? false)) mismatches.push('Observed touch capability differs from requested hasTouch');
        row.capture = {status:b.errors.length || mismatches.length ? 'failed' : 'captured', screenshot:`artifacts/${c.id}.png`,probe:`artifacts/${c.id}.json`,errors:[...b.errors],configurationMismatches:mismatches};
      } catch (error) {
        row.capture = {status:signal?.aborted ? 'cancelled' : 'failed',error:String(error),errors:[...(b?.errors ?? [])]};
        if (b && !signal?.aborted) {
          try {
            const screenshot = await b.page.screenshot({type:'png',timeout:5000});
            signal?.throwIfAborted();
            const file = `artifacts/${c.id}.failure.png`;
            await writeFile(join(out,file),screenshot);
            row.capture.screenshot = file;
          } catch (captureError) {
            row.capture.screenshotError = String(captureError);
            if (signal?.aborted) row.capture.status = 'cancelled';
          }
        }
      }
      finally {
        if (b) try { await b.close(); } catch (error) { row.capture = {...row.capture,status:'failed',cleanupError:String(error)}; }
        await save();
      }
    }
  } catch (error) { report.errors.push(String(error)); }
  finally {
    if (server) try { await server.close(); } catch (error) { report.errors.push(`server cleanup: ${String(error)}`); }
    report.finishedAt = new Date().toISOString();
    report.counts = {captured:0,skipped:0,failed:0,cancelled:0};
    for (const row of report.cases) report.counts[row.capture.status]++;
    report.captureSucceeded = report.errors.length === 0 && report.counts.failed === 0 && report.counts.cancelled === 0;
    await save();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: node scripts/play/capture-matrix.mjs <manifest.json> [output-directory]');
    const manifest = JSON.parse(await readFile(resolve(file),'utf8'));
    const out = resolve(process.argv[3] ?? 'playtest/latest/matrix');
    const revision = execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
    const workingTreeDirty = execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim().length > 0;
    const result = await captureMatrix(manifest,{out,revision,workingTreeDirty});
    console.log(`capture matrix: ${result.captureSucceeded ? 'finished' : 'FAILED'}; ${JSON.stringify(result.counts)}; acceptance unverified; ${join(out,'report.json')}`);
    process.exitCode = result.captureSucceeded ? 0 : 1;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
