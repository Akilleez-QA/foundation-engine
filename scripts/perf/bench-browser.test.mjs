import test from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './bench-browser.mjs';

test('browser options preserve legacy mobile defaults and allow independent touch, mobile and DPR',async()=>{
  for (const [options,expected] of [
    [{},{isMobile:false,hasTouch:false,deviceScaleFactor:1}],
    [{mobile:true},{isMobile:true,hasTouch:true,deviceScaleFactor:1}],
    [{mobile:true,isMobile:false,hasTouch:true,deviceScaleFactor:2},{isMobile:false,hasTouch:true,deviceScaleFactor:2}],
  ]) {
    let contextOptions,closes=0;
    const browser={version:()=> 'mock',close:async()=>{closes++;},newContext:async opts=>{
      contextOptions=opts;
      return {newPage:async()=>({on(){}}),newCDPSession:async()=>({send:async()=>{}})};
    }};
    const b=await launch(options,async()=>browser);
    for(const [key,value] of Object.entries(expected)) assert.equal(contextOptions[key],value);
    assert.deepEqual(contextOptions.viewport,{width:1280,height:800});
    await b.close();assert.equal(closes,1);
  }
});

test('browser initialization failures close the launched process and preserve original cause',async()=>{
  for(const stage of ['context','page','cdp']) {
    const cause=Error(stage);let closes=0;
    const browser={close:async()=>{closes++;throw Error('cleanup');},newContext:async()=>{
      if(stage==='context')throw cause;
      return {newPage:async()=>{if(stage==='page')throw cause;return {};},newCDPSession:async()=>{throw cause;}};
    }};
    await assert.rejects(launch({},async()=>browser),error=>error===cause);
    assert.equal(closes,1);
  }
});

test('strict browser cleanup surfaces failures while legacy cleanup remains best effort',async()=>{
  for(const strictClose of [false,true]) {
    const cause=Error('close failed');
    const browser={version:()=> 'mock',close:async()=>{throw cause;},newContext:async()=>({
      newPage:async()=>({on(){}}),newCDPSession:async()=>({send:async()=>{}}),
    })};
    const b=await launch({strictClose},async()=>browser);
    if(strictClose)await assert.rejects(b.close(),error=>error===cause);
    else await b.close();
  }
});

test('explicit touch capability is set on the existing CDP session, legacy requests add no command',async()=>{
  for(const hasTouch of [undefined,false,true]) {
    const commands=[];
    const browser={version:()=> 'mock',close:async()=>{},newContext:async()=>({
      newPage:async()=>({on(){}}),newCDPSession:async()=>({send:async(...args)=>commands.push(args)}),
    })};
    const b=await launch(hasTouch===undefined ? {} : {hasTouch},async()=>browser);
    assert.deepEqual(commands,hasTouch===undefined ? [] : [['Emulation.setTouchEmulationEnabled',{enabled:hasTouch,maxTouchPoints:1}]]);
    await b.close();
  }
});
