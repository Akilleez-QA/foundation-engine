import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out = resolve(process.argv[2] ?? 'playtest/dependency-preparation');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  limitations: ['Bounded scheduled-task oracle, not frame-time or physical-device acceptance'],
};
let server, browser;
try {
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    plugins: [
      {
        name: 'task-oracle',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/__task.html')) return next();
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><title>Task preparation oracle</title>');
          });
        },
      },
    ],
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  browser = await launch({width: 800, height: 600, strictClose: true});
  await browser.page.goto(server.resolvedUrls.local[0] + '__task.html?flags=dev.silent');
  report.result = await browser.page.evaluate(async () => {
    const fixture = await import('/scripts/play/fixtures/dependency-preparation.ts');
    return fixture.run();
  });
  assert.equal(report.result.total, 256);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
}
