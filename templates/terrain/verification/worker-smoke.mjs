import {serve,open,measure} from '../../../scripts/play/lib.mjs';
import{launch}from'../../../scripts/perf/bench-browser.mjs';
import{PROBE}from'../../../scripts/perf/probe-inject.mjs';
import{mkdirSync,writeFileSync}from'node:fs';import{fileURLToPath}from'node:url';
const dir=fileURLToPath(new URL('./attributes/',import.meta.url));mkdirSync(dir,{recursive:true});
const server=await serve(),reports=[];
try{for(const mobile of [false,true]){
 const name=mobile?'phone':'desktop',b=await launch(mobile?{width:390,height:844,mobile:true}:{width:1280,height:800});
 try{await b.page.addInitScript(PROBE);await open(b,server.url,'yard');await b.page.waitForTimeout(250);
  await b.page.screenshot({path:dir+name+'-before.png'});
  await b.evaluate('window.engine.teleport(-5,-4)');
  await b.evaluate('window.engine.key("r",100)');
  await b.wait('window.engine.state().world.state.terrain.epoch===2',5000);
  const state=await b.evaluate('window.engine.state().world.state');
  if(state.terrainWorker.workers<1||state.terrainWorker.reservedBytes!==0||state.terrain.navigationEpoch!==2)throw Error('worker epoch/admission invariant');
  await b.page.screenshot({path:dir+name+'-after.png'});
  const active=await measure(b,()=>b.evaluate('window.engine.key("ArrowRight",600)'),900),idle=await measure(b,null,600);
  if(active.drawsPerFrame>10||active.trisPerFrame>10000||idle.renders!==0||b.errors.length)throw Error('budget/cleanup/page errors');
  reports.push({name,terrain:state.terrain,worker:state.terrainWorker,scatter:state.scatter.length,active,idle,errors:b.errors});
 }finally{await b.close();}
}}finally{await server.close();}
writeFileSync(dir+'report.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
