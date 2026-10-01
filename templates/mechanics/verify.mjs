import {mkdirSync,writeFileSync} from 'node:fs';
import {launch} from '../../scripts/perf/bench-browser.mjs';
import {PROBE} from '../../scripts/perf/probe-inject.mjs';
const out=new URL('./verification/',import.meta.url);mkdirSync(out,{recursive:true});
const results=[];
for(const [name,viewport] of [['desktop',{width:1280,height:800}],['phone',{width:390,height:844,mobile:true}]]){
 const b=await launch(viewport);
 try{
  await b.page.addInitScript(PROBE);
  await b.page.goto((process.argv[2]??'http://127.0.0.1:4319')+'/?flags=dev.silent#scene/lab');
  await b.page.getByRole('button',{name:'Ride the platform',exact:true}).waitFor();
  await b.page.screenshot({path:new URL(`lab-${name}.png`,out).pathname});
  await b.page.getByRole('button',{name:'Ride the platform',exact:true}).click();
  await b.page.waitForTimeout(400);
  for(const label of ['Step off safely','Collect your probe','Equip the probe','Tag the moving target'])await b.page.getByRole('button',{name:label,exact:true}).click();
  for (const label of ['Place the station', 'Leave the station', 'Pack the station']) await b.page.getByRole('button', {name:label,exact:true}).click();
  await b.page.getByRole('button',{name:'Try the lab again',exact:true}).waitFor();
  const measured=await b.page.evaluate(()=>new Promise(resolve=>{
    let count=0,maxDraws=0,maxTris=0,lastDraws=window.__draws,lastTris=window.__tris;
    const frame=()=>{const d=window.__draws,t=window.__tris;maxDraws=Math.max(maxDraws,d-lastDraws);maxTris=Math.max(maxTris,t-lastTris);lastDraws=d;lastTris=t;if(++count===15)resolve({maxDraws,maxTris});else requestAnimationFrame(frame);};requestAnimationFrame(frame);
  }));
  await b.page.screenshot({path:new URL(`lab-${name}-complete.png`,out).pathname});
  const fit=await b.page.locator('.scene-overlay section').evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,within:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};});
  if(!fit.within)throw Error('panel outside viewport');
  await b.page.getByRole('button',{name:'Try the lab again',exact:true}).click();await b.page.getByRole('button',{name:'Ride the platform',exact:true}).waitFor();
  await b.page.reload();
  for (const label of ['Ride the platform', 'Step off safely', 'Collect your probe', 'Equip the probe']) await b.page.getByRole('button', {name:label,exact:true}).click();
  await b.page.getByRole('button', {name:'Tag the moving target',exact:true}).waitFor();
  if(b.errors.length)throw Error(b.errors.join('\n'));
  results.push({view:name,viewport,measured,panel:fit,errors:b.errors,complete:true,restart:true,reload:true});
 }finally{await b.close();}
}
writeFileSync(new URL('interaction.json',out),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
