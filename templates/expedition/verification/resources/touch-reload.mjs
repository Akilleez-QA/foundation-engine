import {serve,open,measure} from '../../../../scripts/play/lib.mjs';
import {PROBE} from '../../../../scripts/perf/probe-inject.mjs';
import {launch} from '../../../../scripts/perf/bench-browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('.',import.meta.url));mkdirSync(dir,{recursive:true});
const server=await serve(),b=await launch({width:390,height:844,mobile:true});
try{
 await b.page.addInitScript(PROBE);
 await open(b,server.url,'field');
 const walking=await measure(b,()=>b.page.getByRole('button',{name:'Begin survey',exact:true}).tap(),1200);
 await b.page.waitForFunction(()=>window.engine.state().world.state.expedition.collected===1);
 for(let n=2;n<=3;n++){
  await b.page.getByRole('button',{name:'Visit next station',exact:true}).tap();
  await b.page.waitForFunction(n=>window.engine.state().world.state.expedition.collected===n,n);
 }
 await b.page.getByRole('button',{name:'Survey material',exact:true}).tap();
 await b.page.getByRole('button',{name:'Collect material',exact:true}).waitFor({state:'visible'});
 await b.page.screenshot({path:dir+'/mobile-surveyed.png'});
 await b.page.getByRole('button',{name:'Collect material',exact:true}).tap();
 await b.page.getByRole('button',{name:'Make a plate',exact:true}).waitFor({state:'visible'});
 await b.page.getByRole('button',{name:'Make a plate',exact:true}).tap();
 await b.page.getByRole('button',{name:'Plate complete',exact:true}).waitFor({state:'visible'});
 await b.page.screenshot({path:dir+'/mobile-complete.png'});
 const before=await b.evaluate('window.engine.state().world.state.resources');
 await b.page.reload();await b.wait('!!window.engine && window.engine.state().world.state.resources?.stage === "complete"',30000);
 const after=await b.evaluate('window.engine.state().world.state.resources');
 if(before.ore!==2||before.plates!==1||before.reserve!==4||JSON.stringify(before)!==JSON.stringify(after))throw Error('resource conservation/reload failed');
 await b.page.setViewportSize({width:1280,height:800});await b.page.screenshot({path:dir+'/desktop-complete.png'});
 const idle=await measure(b,null,600);
 if(b.errors.length)throw Error(b.errors.join('\n'));
 writeFileSync(dir+'/touch-reload.json',JSON.stringify({before,after,walking,idle,errors:b.errors},null,2));
 console.log(JSON.stringify({before,after,walking,idle,errors:b.errors}));
}finally{await b.close();await server.close();}
