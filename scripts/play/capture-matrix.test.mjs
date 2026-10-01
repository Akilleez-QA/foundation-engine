import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureMatrix, validateMatrix} from './capture-matrix.mjs';

const observed = () => ({viewport:{width:700,height:500,deviceScaleFactor:2},maxTouchPoints:1});
const manifest = () => ({version:1,profiles:[{id:'custom',viewport:{width:700,height:500},hasTouch:true,isMobile:false,deviceScaleFactor:2,support:'experimental',inputs:['touch','keyboard'],graphicsQuery:{quality:'reference'}}],cases:[{id:'entry',profile:'custom',scene:'main',task:'Read and navigate',criteria:['Content remains visible']} ]});
test('matrix validates independent creator choices and rejects malformed references and geometry', () => {
  assert.deepEqual(validateMatrix(manifest()),[]);
  for (const change of [
    m => m.profiles[0].viewport.width = Infinity,
    m => m.profiles[0].deviceScaleFactor = 0,
    m => m.profiles[0].hasTouch = 'yes',
    m => m.profiles.push({...m.profiles[0]}),
    m => m.cases[0].profile = 'unknown',
    m => m.cases[0].id = '../escape',
    m => m.cases[0].criteria = [' '],
    m => m.profiles[0].graphicsQuery = {flags:'audio'},
  ]) {
    const m = manifest(); change(m); assert.ok(validateMatrix(m).length);
  }
  assert.ok(validateMatrix(null).length);
});

test('serial capture reuses owners, snapshots manifest and keeps declared tasks unverified', async () => {
  const out = await mkdtemp(join(tmpdir(),'matrix-'));
  const m = manifest();
  m.profiles.push({...m.profiles[0],id:'unsupported',support:'unsupported'});
  m.cases.push({...m.cases[0],id:'skip',profile:'unsupported'},{...m.cases[0],id:'second'});
  let active = 0, serverClosed = 0;
  const launched = [], opened = [];
  try {
    const result = await captureMatrix(m,{out,revision:'abc'},{
      serve:async()=>{m.cases[0].scene='mutated';return {url:'http://local',close:async()=>{serverClosed++;}};},
      launch:async options=>{
        assert.equal(active,0);active++;launched.push(options);
        return {version:'test',errors:[],evaluate:async()=>({...observed(),state:'snapshot'}),page:{screenshot:async()=>Buffer.from('png')},close:async()=>{active--;}};
      },
      open:async(_b,_url,scene,options)=>{opened.push([scene,options]);return [];},
    });
    assert.equal(result.captureSucceeded,true);
    assert.equal(serverClosed,1);assert.equal(active,0);
    assert.equal(launched.length,2);
    assert.deepEqual(launched[0],{width:700,height:500,hasTouch:true,isMobile:false,deviceScaleFactor:2,strictClose:true});
    assert.equal(opened[0][0],'main');assert.deepEqual(opened[0][1].query,{quality:'reference'});
    assert.deepEqual(result.cases.map(c=>c.capture.status),['captured','skipped','captured']);
    assert.ok(result.cases.every(c=>c.acceptance.status==='unverified'));
    assert.equal(JSON.parse(await readFile(join(out,'report.json'),'utf8')).environment,'browser-emulation');
  } finally {await rm(out,{recursive:true,force:true});}
});

test('capture failure is retained, closes browser, continues later cases and never passes acceptance', async () => {
  const out = await mkdtemp(join(tmpdir(),'matrix-'));
  const m = manifest();m.cases.push({...m.cases[0],id:'second'});
  let calls = 0, closed = 0;
  try {
    const result = await captureMatrix(m,{out,revision:'abc'},{
      serve:async()=>({url:'http://local',close:async()=>{}}),
      launch:async()=>({version:'test',errors:[],evaluate:async()=>observed(),page:{screenshot:async()=>Buffer.from('png')},close:async()=>{closed++;}}),
      open:async()=>{if (++calls === 1) throw Error('navigation failed');return [];},
    });
    assert.equal(result.captureSucceeded,false);assert.equal(closed,2);
    assert.deepEqual(result.cases.map(c=>c.capture.status),['failed','captured']);
    assert.match(result.cases[0].capture.error,/navigation failed/);
    assert.equal(result.cases[1].acceptance.status,'unverified');
    assert.equal(JSON.parse(await readFile(join(out,'report.json'),'utf8')).captureSucceeded,false);
  } finally {await rm(out,{recursive:true,force:true});}
});

test('pre-aborted capture records failure without starting external owners',async()=>{
  const out=await mkdtemp(join(tmpdir(),'matrix-'));const life=new AbortController();life.abort();
  try {
    const result=await captureMatrix(manifest(),{out,revision:'abc',signal:life.signal},{serve:async()=>assert.fail('must not start')});
    assert.equal(result.captureSucceeded,false);assert.equal(result.cases[0].capture.status,'cancelled');
  } finally {await rm(out,{recursive:true,force:true});}
});

test('abort during screenshot cannot claim capture and cancels remaining cases without launching',async()=>{
  const out=await mkdtemp(join(tmpdir(),'matrix-')), life=new AbortController();
  const m=manifest();m.cases.push({...m.cases[0],id:'later'});
  let launches=0,closes=0;
  try {
    const result=await captureMatrix(m,{out,revision:'abc',workingTreeDirty:true,signal:life.signal},{
      serve:async()=>({url:'http://local',close:async()=>{}}),
      launch:async()=>{
        launches++;
        return {errors:[],evaluate:async()=>observed(),page:{screenshot:async()=>{life.abort();return Buffer.from('png');}},close:async()=>{closes++;}};
      },
      open:async()=>[],
    });
    assert.equal(launches,1);assert.equal(closes,1);
    assert.equal(result.workingTreeDirty,true);
    assert.equal(result.captureSucceeded,false);
    assert.deepEqual(result.counts,{captured:0,skipped:0,failed:0,cancelled:2});
    assert.ok(result.cases.every(c=>c.acceptance.status==='unverified'));
  } finally {await rm(out,{recursive:true,force:true});}
});

test('empty and all-unsupported matrices report zero captures without starting a browser',async()=>{
  const out=await mkdtemp(join(tmpdir(),'matrix-'));
  try {
    for(const m of [{version:1,profiles:[],cases:[]},manifest()]) {
      if(m.profiles.length)m.profiles[0].support='unsupported';
      const result=await captureMatrix(m,{out,revision:'abc'},{serve:async()=>assert.fail('no owner required')});
      assert.equal(result.captureSucceeded,true);assert.equal(result.counts.captured,0);
      assert.equal(result.counts.skipped,m.cases.length);
      assert.equal(result.workingTreeDirty,null,'unknown is not implicitly clean');
    }
  } finally {await rm(out,{recursive:true,force:true});}
});

test('case named report keeps its probe separate from the matrix report',async()=>{
  const out=await mkdtemp(join(tmpdir(),'matrix-'));const m=manifest();m.cases[0].id='report';
  try {
    const result=await captureMatrix(m,{out,revision:'abc'},{
      serve:async()=>({url:'http://local',close:async()=>{}}),
      launch:async()=>({errors:[],evaluate:async()=>({...observed(),value:42}),page:{screenshot:async()=>Buffer.from('png')},close:async()=>{}}),
      open:async()=>[],
    });
    const probe=JSON.parse(await readFile(join(out,result.cases[0].capture.probe),'utf8'));
    assert.equal(probe.case,'report');assert.deepEqual(probe.probe,{...observed(),value:42});
    const summary=JSON.parse(await readFile(join(out,'report.json'),'utf8'));
    assert.equal(summary.cases[0].id,'report');assert.equal(summary.counts.captured,1);
  } finally {await rm(out,{recursive:true,force:true});}
});

test('observed capability mismatch fails capture while retaining its screenshot and probe',async()=>{
  const out=await mkdtemp(join(tmpdir(),'matrix-'));
  try {
    const result=await captureMatrix(manifest(),{out,revision:'abc'},{
      serve:async()=>({url:'http://local',close:async()=>{}}),
      launch:async()=>({errors:[],evaluate:async()=>({...observed(),maxTouchPoints:0}),page:{screenshot:async()=>Buffer.from('png')},close:async()=>{}}),
      open:async()=>[],
    });
    assert.equal(result.captureSucceeded,false);
    assert.match(result.cases[0].capture.configurationMismatches[0],/touch/);
    assert.ok(result.cases[0].capture.screenshot);assert.ok(result.cases[0].capture.probe);
  } finally {await rm(out,{recursive:true,force:true});}
});

test('step schema rejects ambiguity, unsupported input and unbounded work before launching', async () => {
  for (const steps of [
    [{eval:'anything'}], [{click:'button',key:'Enter'}], [{waitFor:{selector:'button',state:'attached'}}],
    [{tap:'button',timeoutMs:10001}], [{key:'Enter',timeoutMs:5}], Array(65).fill({key:'Enter'}),
    [{click:'button'}], [{key:'x'.repeat(81)}], [{tap:'x'.repeat(513)}],
  ]) {
    const m = manifest(); m.cases[0].steps = steps;
    assert.ok(validateMatrix(m).length);
    await assert.rejects(captureMatrix(m, {out:'unused',revision:'test'}, {serve:() => assert.fail('must not launch')}), /Invalid capture matrix/);
  }
  const m = manifest(); m.profiles[0].hasTouch = false; m.cases[0].steps = [{tap:'button'}];
  assert.ok(validateMatrix(m).length);
});

test('authored steps run in order on the selected case browser before capture without certifying criteria', async () => {
  const out = await mkdtemp(join(tmpdir(),'matrix-steps-'));
  const m = manifest();
  m.profiles[0].inputs.push('pointer');
  m.cases[0].steps = [{click:'#start',timeoutMs:900}, {tap:'#menu'}, {waitFor:{selector:'#panel',state:'visible'},timeoutMs:800}, {key:'Escape'}, {waitFor:{selector:'#panel',state:'hidden'}}];
  const calls = [];
  try {
    const result = await captureMatrix(m,{out,revision:'test'},{
      serve:async()=>({url:'http://local',close:async()=>{}}),
      launch:async()=>({errors:[],evaluate:async()=>observed(),page:{
        locator:selector=>({click:async options=>calls.push(['click',selector,options]),tap:async options=>calls.push(['tap',selector,options]),waitFor:async options=>calls.push(['waitFor',selector,options])}),
        keyboard:{press:async key=>calls.push(['key',key])}, screenshot:async()=>{calls.push(['capture']);return Buffer.from('png');},
      },close:async()=>{}}), open:async()=>[],
    });
    assert.deepEqual(calls,[['click','#start',{timeout:900}],['tap','#menu',{timeout:5000}],['waitFor','#panel',{state:'visible',timeout:800}],['key','Escape'],['waitFor','#panel',{state:'hidden',timeout:5000}],['capture']]);
    assert.ok(result.cases[0].steps.every(step=>step.status==='completed'));
    assert.equal(result.cases[0].acceptance.status,'unverified');
    assert.equal(result.captureSucceeded,true);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('failed interaction saves failure screenshot, stops that sequence and continues later cases with cleanup', async () => {
  const out = await mkdtemp(join(tmpdir(),'matrix-steps-'));
  const m = manifest(); m.cases[0].steps = [{tap:'#missing'},{key:'Enter'}];
  m.cases.push({...m.cases[0],id:'later',steps:[]});
  let closed = 0;
  try {
    const result = await captureMatrix(m,{out,revision:'test'},{
      serve:async()=>({url:'http://local',close:async()=>{}}),
      launch:async()=>({errors:[],evaluate:async()=>observed(),page:{
        locator:()=>({tap:async()=>{throw Error('target missing');}}),
        keyboard:{press:async()=>assert.fail('must stop steps')},screenshot:async()=>Buffer.from('failure evidence'),
      },close:async()=>{closed++;}}), open:async()=>[],
    });
    assert.equal(closed,2);
    assert.deepEqual(result.cases.map(row=>row.capture.status),['failed','captured']);
    assert.equal(result.cases[0].steps.length,1);
    assert.equal(result.cases[0].steps[0].status,'failed');
    assert.equal(await readFile(join(out,result.cases[0].capture.screenshot),'utf8'),'failure evidence');
    assert.ok(result.cases.every(row=>row.acceptance.status==='unverified'));
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('cancellation after an interaction prevents later steps and capture while releasing owners', async () => {
  const out = await mkdtemp(join(tmpdir(),'matrix-steps-')), life = new AbortController();
  const m = manifest(); m.cases[0].steps = [{tap:'#menu'},{key:'Escape'}];
  let closed = 0;
  try {
    const result = await captureMatrix(m,{out,revision:'test',signal:life.signal},{
      serve:async()=>({url:'http://local',close:async()=>{}}),
      launch:async()=>({errors:[],page:{locator:()=>({tap:async()=>life.abort()}),keyboard:{press:async()=>assert.fail('cancelled')},screenshot:async()=>assert.fail('cancelled')},close:async()=>{closed++;}}),
      open:async()=>[],
    });
    assert.equal(closed,1);
    assert.equal(result.cases[0].capture.status,'cancelled');
    assert.equal(result.cases[0].steps[0].status,'cancelled');
    assert.equal(result.cases[0].steps.length,1);
  } finally { await rm(out,{recursive:true,force:true}); }
});


test('failure screenshot errors preserve the step failure and always release owners', async () => {
  const out = await mkdtemp(join(tmpdir(),'matrix-failure-'));
  const m = manifest();
  m.cases[0].steps = [{tap:'#missing'}];
  let closed = 0;
  try {
    const result = await captureMatrix(m,{out,revision:'test'},{
      serve:async()=>({url:'http://local',close:async()=>{closed++;}}),
      launch:async()=>({errors:[],page:{
        locator:()=>({tap:async()=>{throw Error('target missing');}}),
        screenshot:async()=>{throw Error('page gone');},
      },close:async()=>{closed++;}}),
      open:async()=>[],
    });
    assert.equal(closed,2);
    assert.equal(result.captureSucceeded,false);
    assert.match(result.cases[0].capture.error,/target missing/);
    assert.match(result.cases[0].capture.screenshotError,/page gone/);
    assert.equal(result.cases[0].capture.screenshot,undefined);
  } finally { await rm(out,{recursive:true,force:true}); }
});

test('stock settings example explicitly selects distinct touch and pointer journeys', async () => {
  const m = JSON.parse(await readFile(new URL('./examples/capture-settings.json',import.meta.url),'utf8'));
  assert.deepEqual(validateMatrix(m),[]);
  assert.deepEqual(m.profiles.map(p=>p.viewport),[{width:390,height:844},{width:820,height:1180},{width:1280,height:800}]);
  for (const c of m.cases) {
    const p = m.profiles.find(p=>p.id===c.profile);
    assert.equal(p.support,'experimental');
    assert.ok(c.steps.some(step=>step.waitFor?.state==='hidden'));
    if (p.hasTouch) assert.ok(c.steps.every(step=>!('click' in step) && !('key' in step)));
    else assert.ok(c.steps.some(step=>'click' in step));
  }
});
