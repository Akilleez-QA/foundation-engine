import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {diagnosticReport} from './diagnostic-report.mjs';

test('scenario and independent browser/server failures replace stale success evidence and preserve causes', async () => {
  const out = mkdtempSync(join(tmpdir(),'diagnostic-report-'));
  const path = join(out,'report.json');
  writeFileSync(path,JSON.stringify({passed:true,revision:'old'}));
  const scenario = Error('scenario failed');
  const browser = Error('browser close failed');
  const server = Error('server close failed');
  const report = {revision:'current'};
  const evidence = diagnosticReport(report,path);
  const closed = [];
  try {
    try { throw scenario; }
    catch (error) { evidence.fail(error); }
    finally {
      await evidence.close({close:async()=>{closed.push('browser');throw browser;}},'browser cleanup');
      await evidence.close({close:async()=>{closed.push('server');throw server;}},'server cleanup');
    }
    assert.throws(()=>evidence.finish(),error=>{
      assert.deepEqual(error.errors,[scenario,browser,server]);
      return true;
    });
    assert.deepEqual(closed,['browser','server']);
    const saved = JSON.parse(readFileSync(path,'utf8'));
    assert.equal(saved.revision,'current');
    assert.equal(saved.passed,false);
    assert.deepEqual(saved.failures.map(f=>f.stage),['scenario','browser cleanup','server cleanup']);
  } finally { rmSync(out,{recursive:true,force:true}); }
});

test('a later scenario success cannot erase an earlier cleanup failure', async () => {
  let saved;
  const report = {};
  const evidence = diagnosticReport(report,'unused',(_path,value)=>{saved=JSON.parse(value);});
  const cleanup = Error('close failed');
  await evidence.close({close:()=>{throw cleanup;}},'browser cleanup');
  report.passed = true;
  assert.throws(()=>evidence.finish(),error=>error.errors[0]===cleanup);
  assert.equal(saved.passed,false);
});

test('report write failure preserves scenario and cleanup causes, including unprintable throws', async () => {
  const opaque = {toString(){throw Error('cannot print');}};
  const write = Error('disk full');
  const evidence = diagnosticReport({},'unused',()=>{throw write;});
  evidence.fail(opaque);
  await evidence.close(undefined,'not acquired');
  assert.throws(()=>evidence.finish(),error=>{
    assert.deepEqual(error.errors,[opaque,write]);
    return true;
  });
});

test('successful cleanup writes the explicit scenario result without inventing a pass', async () => {
  let saved;
  const report = {};
  const evidence = diagnosticReport(report,'unused',(_path,value)=>{saved=JSON.parse(value);});
  await evidence.close({close:async()=>{}},'server cleanup');
  evidence.finish();
  assert.equal(saved.passed,false);
  report.passed = true;
  evidence.finish();
  assert.equal(saved.passed,true);
  assert.deepEqual(saved.failures,[]);
});
