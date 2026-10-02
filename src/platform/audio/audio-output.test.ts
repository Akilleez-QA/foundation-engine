import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_CUES, createAudioOutput, cueGate, synthCue, type CueDef } from './audio-output';

test('every core cue has finite samples, headroom, audible energy and click-free edges at common rates', () => {
  for (const rate of [44100, 48000]) for (const cue of CORE_CUES) {
    const samples = synthCue(cue, rate); let peak = 0, power = 0;
    for (const s of samples) { assert.ok(Number.isFinite(s)); peak = Math.max(peak, Math.abs(s)); power += s * s; }
    assert.ok(peak < .75, cue.id + ' peak'); assert.ok(Math.sqrt(power / samples.length) > .002, cue.id + ' silent');
    assert.equal(samples[0], 0); assert.equal(samples.at(-1), 0);
    assert.equal(samples.length, Math.ceil(cue.duration * rate));
  }
});

/** A fake AudioContext that records what the output does. */
function fakeContext(state: AudioContextState = 'running') {
  const log: string[] = [];
  const sources: { onended: (() => void) | null; stops: number }[] = [];
  const gains: { gain: { value: number } }[] = [];
  const param=()=>({value:0});
  const panners: {positionX:{value:number};positionY:{value:number};positionZ:{value:number};disconnected:boolean}[]=[];
  const ctx = {
    listener:{positionX:param(),positionY:param(),positionZ:param(),forwardX:param(),forwardY:param(),forwardZ:param(),upX:param(),upY:param(),upZ:param()},
    createPanner:()=>{const p={positionX:param(),positionY:param(),positionZ:param(),disconnected:false,connect:()=>{},disconnect:()=>{p.disconnected=true;}};panners.push(p);return p;},
    state, sampleRate: 48000, destination: {},
    createGain: () => { const g = { gain: { value: 1 }, connect: () => log.push('gain.connect'), disconnect: () => {} }; gains.push(g); return g; },
    createBuffer: (_c: number, n: number) => ({ length: n, copyToChannel: () => {} }),
    createBufferSource: () => { const source = { onended: null as (() => void) | null, stops: 0, buffer: null, connect: () => {}, start: () => log.push('start'), stop: () => { source.stops++; log.push('stop'); }, disconnect: () => {} }; sources.push(source); return source; },
    resume: async () => { log.push('resume'); ctx.state = 'running'; }, suspend: async () => { log.push('suspend'); }, close: async () => { log.push('close'); },
  };
  return { ctx: ctx as unknown as AudioContext & { state: AudioContextState }, log, sources, gains, panners };
}

test('silent mode never creates an AudioContext and never plays: tests and benches cannot make a sound', () => {
  let made = 0;
  const out = createAudioOutput({ silent: () => true, muted: () => false, effects: () => 1, music: () => 1, createContext: () => { made++; return fakeContext().ctx; }, createElement: () => { throw Error('no element in silent mode'); } });
  out.unlock(); assert.equal(out.play('ui.click'), false); out.music('/music/theme.m4a');
  assert.equal(made, 0); assert.equal(out.stats.contexts, 0); assert.equal(out.stats.played, 0);
});

test('mute and a zero effects volume skip playback; the master gain follows the settings', () => {
  let muted = true, effects = .5; const listeners: (() => void)[] = [];
  const { ctx, log } = fakeContext();
  const out = createAudioOutput({ silent: () => false, muted: () => muted, effects: () => effects, music: () => 1, onChange: fn => { listeners.push(fn); return () => {}; }, createContext: () => ctx });
  assert.equal(out.play('ui.click'), false, 'muted'); assert.equal(out.stats.contexts, 0, 'a muted output does not even create its context');
  muted = false; listeners.forEach(f => f());
  out.unlock(); assert.equal(out.play('ui.click'), true); assert.deepEqual(log.filter(l => l === 'start'), ['start']);
  effects = 0; listeners.forEach(f => f()); assert.equal(out.play('ui.click'), false);
  out.dispose(); assert.ok(log.includes('close'));
});

test('a suspended context (before a gesture) skips; unlock resumes; an unknown cue is reported once', async () => {
  const { ctx } = fakeContext('suspended'); const reports: string[] = [];
  const extra: CueDef = { id: 'demo.ping', duration: .1, steps: [{ tone: { at: 0, duration: .08, hz: 880 } }] };
  const out = createAudioOutput({ silent: () => false, muted: () => false, effects: () => 1, music: () => 1, createContext: () => ctx, cues: [...CORE_CUES, extra], report: m => reports.push(m) });
  assert.equal(out.play('demo.ping'), false);
  out.unlock(); await Promise.resolve();
  assert.equal(out.play('demo.ping'), true);
  out.play('demo.nope'); out.play('demo.nope'); assert.deepEqual(reports, ["no cue 'demo.nope'"]);
});

test('cueGate lets a repeatable cue through once per interval', () => {
  let now = 0; const gate = cueGate(4, () => now);
  assert.equal(gate(), true); now = 3.9; assert.equal(gate(), false); now = 4; assert.equal(gate(), true);
});


test('voice handles apply separate gain, notify natural completion once and stop idempotently', () => {
  const { ctx, sources, gains } = fakeContext(); let ended = 0;
  const output = createAudioOutput({ silent: () => false, muted: () => false, effects: () => .8, music: () => 1, createContext: () => ctx });
  const voice = output.playVoice('ui.click', { gain: .5, onEnded: () => { ended++; } })!;
  assert.equal(gains[0].gain.value, .8); assert.equal(gains[1].gain.value, .5);
  voice.setGain(.2); assert.equal(gains[1].gain.value, .2); assert.equal(gains[0].gain.value, .8);
  assert.throws(() => voice.setGain(NaN)); sources[0].onended!(); voice.stop();
  assert.equal(voice.ended, true); assert.equal(ended, 1); assert.equal(sources[0].stops, 0);
  const second = output.playVoice('ui.click', { onEnded: () => { ended++; } })!;
  output.dispose(); second.stop(); output.dispose(); assert.equal(ended, 2); assert.equal(sources[1].stops, 1);
  assert.equal(output.playVoice('ui.click'), null);
});
test('silent voice playback never creates a context or invokes completion', () => {
  const output = createAudioOutput({ silent: () => true, muted: () => false, effects: () => 1, music: () => 1, createContext: () => { throw Error('must not create'); } });
  assert.equal(output.playVoice('ui.click', { onEnded: () => { throw Error('not started'); } }), null);
  output.dispose();
});
test('spatial voices use one context, track source and listener, and release panners',()=>{
 const {ctx,panners}=fakeContext();const out=createAudioOutput({silent:()=>false,muted:()=>false,effects:()=>1,music:()=>1,createContext:()=>ctx,maxVoices:1,maxBuffers:1});
 out.setListener([1,2,3],[0,0,-1],[0,1,0]);assert.equal(out.stats.contexts,0);
 const voice=out.playVoice('ui.click',{spatial:{position:[4,5,6]}})!;assert.equal(out.stats.contexts,1);assert.equal(ctx.listener.positionX.value,1);assert.equal(panners[0].positionZ.value,6);
 voice.setPosition!([7,8,9]);assert.equal(panners[0].positionX.value,7);assert.equal(out.playVoice('ui.click'),null);voice.stop();assert.equal(panners[0].disconnected,true);assert.ok(out.playVoice('ui.click'));
 assert.throws(()=>out.setListener([0,0,0],[0,1,0],[0,1,0]));out.dispose();
});
test('invalid spatial data is rejected without creating an output',()=>{let made=0;const out=createAudioOutput({silent:()=>true,muted:()=>false,effects:()=>1,music:()=>1,createContext:()=>{made++;return fakeContext().ctx;}});assert.throws(()=>out.playVoice('ui.click',{spatial:{position:[NaN,0,0]}}));assert.equal(out.playVoice('ui.click',{spatial:{position:[0,0,0]}}),null);assert.equal(made,0);});

test('decoded cache byte budget evicts by sample bytes and rejects oversized single cues',()=>{
 const {ctx}=fakeContext();let allocations=0;const create=ctx.createBuffer.bind(ctx);ctx.createBuffer=(...args)=>{allocations++;return create(...args);};
 const output=createAudioOutput({silent:()=>false,muted:()=>false,effects:()=>1,music:()=>1,createContext:()=>ctx,maxBufferBytes:16000});
 output.playVoice('ui.click',{variant:0})!.stop();output.playVoice('ui.click',{variant:1})!.stop();output.playVoice('ui.click',{variant:0})!.stop();
 assert.equal(allocations,3,'two 15,360-byte buffers cannot fit together');assert.equal(output.playVoice('ui.success'),null);assert.equal(allocations,3);output.dispose();
});
test('cue registration snapshots mutable author data and validates before subscribing',()=>{
 let subscriptions=0;const options={silent:()=>false,muted:()=>false,effects:()=>1,music:()=>1,onChange:()=>{subscriptions++;return ()=>{};},createContext:()=>fakeContext().ctx};
 assert.throws(()=>createAudioOutput({...options,maxBuffers:0}));assert.equal(subscriptions,0);
 const cue:CueDef={id:'test',duration:.1,steps:[{tone:{at:0,duration:.08,hz:400}}]};const output=createAudioOutput({...options,cues:[cue]});cue.duration=Infinity;
 assert.ok(output.playVoice('test'));output.dispose();assert.throws(()=>synthCue(cue,48000));assert.throws(()=>synthCue(CORE_CUES[0],Infinity));
});
test('music pauses in hidden tabs even without an AudioContext and stays paused across unlock',()=>{
 let plays=0,pauses=0;const element={paused:true,play(){plays++;return Promise.resolve();},pause(){pauses++;}} as unknown as HTMLAudioElement;
 const output=createAudioOutput({silent:()=>false,muted:()=>false,effects:()=>1,music:()=>1,createElement:()=>element,createContext:()=>fakeContext().ctx});
 output.music('track');assert.equal(plays,1);output.setHidden(true);assert.equal(pauses,1);output.unlock();output.music('other');assert.equal(plays,1);output.setHidden(false);assert.equal(plays,2);output.dispose();
});
test('stopping errors still release voices and disposal continues through remaining resources',()=>{
 const {ctx,sources,log}=fakeContext();let finished=0;const reports:string[]=[];
 const output=createAudioOutput({silent:()=>false,muted:()=>false,effects:()=>1,music:()=>1,createContext:()=>ctx,report:m=>reports.push(m)});
 const first=output.playVoice('ui.click',{onEnded:()=>finished++})!;output.playVoice('ui.count',{onEnded:()=>finished++});
 (sources[0] as unknown as {stop():void}).stop=()=>{throw Error('stop failure');};output.dispose();assert.equal(first.ended,true);assert.equal(finished,2);assert.ok(log.includes('close'));assert.equal(reports.length,1);
});

for (const fallbackThrows of [false, true]) {
 test(`audio disposal survives completion and reporter failures (console throws ${fallbackThrows})`,()=>{
  const {ctx,log}=fakeContext();
  const completionFailure={toString(){throw Error('conversion failed');}};
  const reporterFailure=Error('report failed');
  const diagnostics:unknown[][]=[];
  const previous=console.error;
  console.error=(...args)=>{diagnostics.push(args);if(fallbackThrows)throw Error('sink failed');};
  let finished=0,reports=0;
  const output=createAudioOutput({silent:()=>false,muted:()=>false,effects:()=>1,music:()=>1,createContext:()=>ctx,
   report(){reports++;output.dispose();throw reporterFailure;}});
  try{
   const first=output.playVoice('ui.click',{onEnded(){throw completionFailure;}})!;
   const second=output.playVoice('ui.count',{onEnded(){finished++;}})!;
   assert.doesNotThrow(()=>output.dispose());
   assert.equal(first.ended,true);assert.equal(second.ended,true);assert.equal(finished,1);
   assert.equal(reports,1);assert.equal(diagnostics.length,1);
   const failures=(diagnostics[0][1] as AggregateError).errors;
   assert.equal(failures[0].cause,completionFailure);assert.equal(failures[1],reporterFailure);
   assert.equal(log.filter(entry=>entry==='close').length,1);
   output.dispose();assert.equal(finished,1);assert.equal(log.filter(entry=>entry==='close').length,1);
  }finally{console.error=previous;output.dispose();}
 });
}
test('music URLs go through the composition root\'s resolver (the public base)',()=>{
 const element={paused:true,src:'',play(){return Promise.resolve();},pause(){}} as unknown as HTMLAudioElement;
 const output=createAudioOutput({silent:()=>false,muted:()=>false,effects:()=>1,music:()=>1,createElement:()=>element,createContext:()=>fakeContext().ctx,resolveUrl:url=>'https://host/sub/'+url.replace(/^\//,'')});
 output.music('/music/theme.m4a');assert.equal(element.src,'https://host/sub/music/theme.m4a');output.dispose();
});
