import {writeFileSync} from 'node:fs';
import {launch} from '../../scripts/perf/bench-browser.mjs';
const results=[];
for (const [name,viewport] of [['desktop',{width:1280,height:800}],['phone',{width:390,height:844,mobile:true}]]) {
 const b=await launch(viewport);
 try {
  await b.page.goto((process.argv[2]??'http://127.0.0.1:4319')+'/?flags=dev.silent,dev.test-api#scene/lab');
  await b.page.waitForFunction(()=>window.engine?.state().world?.state.model?.ready===true);
  const values=await b.page.evaluate(()=>{engine.clock.hold();const a=engine.state().world.state.model.socketY;engine.clock.step(200);const b=engine.state().world.state.model.socketY;engine.clock.resume();return {a,b,models:engine.probe('models')};});
  if(values.a===values.b||values.models.instances!==1)throw Error('animated model socket did not advance');
  for(let i=0;i<3;i++){
   await b.page.evaluate(i=>engine.goto('lab',{reload:String(i)}),i);
   await b.page.waitForFunction(()=>window.engine.state().world?.state.model?.ready===true);
  }
  const stats=await b.page.evaluate(()=>engine.probe('models'));
  if(stats.instances!==1||Object.values(stats.fetches).reduce((a,b)=>a+b,0)!==1)throw Error('model ownership or cached fetch mismatch');
  await b.page.screenshot({path:new URL(`./verification/model-${name}.png`,import.meta.url).pathname});
  if(b.errors.length)throw Error(b.errors.join('\n'));
  results.push({view:name,values,afterThreeVisits:stats,errors:b.errors});
 }finally{await b.close();}
}
writeFileSync(new URL('./verification/models.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
