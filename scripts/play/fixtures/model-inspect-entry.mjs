// Original GLB through the stock asset service, model owner and dev inspection bridge.
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild, defineGame, defineScene, defineSystem, defineAsset, Name, Transform, Model} from '../../../src/author/index.ts';
import {createTestApi} from '../../../src/dev/test-api.ts';
const brief = defineBuild({goal:'Inspect the actually adopted model through optional diagnostics.',genre:'diagnostic',pitch:'Bounded model inspection.',coreLoop:['Play','Inspect','Replace'],devices:{targets:['desktop'],minimum:'desktop',input:['keyboard','pointer']},success:[{id:'S1',check:'Actual model playback, adoption and incomplete geometry remain distinguishable.',how:'playtest',by:'scripts/play/model-inspect-check.mjs'}]});
const game = defineGame({id:'model-inspect',version:'0.1.0',title:'Model inspection',firstScene:'sample'});
const assets = ['first','second'].map((id,i) => defineAsset({id,type:'model',url:i ? '/__model-inspect/beacon.glb' : '/models/mechanics/beacon.glb',licence:'CC0-1.0',author:'Foundation Engine contributors',source:'templates/mechanics/game/tools/generate-fixture.mjs'}));
const frame = defineSystem({id:'diagnostic-frame',phase:'frame',run(){}});
let entity, ctx, last, prior;
const sample = defineScene({id:'sample',title:'Original beacon',systems:[frame],view:{camera:{position:[3,2.5,4],target:[0,.6,0],fov:42},background:0x243347},enter(context){ctx=context;entity=ctx.world.spawn(Name({name:'beacon'}),Transform(),Model({asset:'first',clip:'pulse',playing:false}));},exit(){ctx=undefined;}});
const compiled = compileGame({brief,game,defs:[sample,frame,...assets]});
const app = createApp([...layerModules(game,brief),...compiled.modules],{mode:'test',flag:id=>appFeatures().enabled(id),probes:true});
const booted=app.boot();window.engine=createTestApi(app,booted);
const read=()=>window.engine.model({entity,expectedEpoch:window.engine.state().scene?.epoch ?? 0,sockets:['hand','shoulder','missing'],clipLimit:1,maxNodes:128});
const show=()=>{last=read();document.querySelector('#inspection').textContent=JSON.stringify(last,null,2);return last;};
const life=new AbortController();
for(const id of ['inspect','play','pause','restart','replace','pose','clear-pose'])document.querySelector('#'+id).addEventListener('click',()=>{
  if(!ctx)return;
  const model=ctx.world.get(entity,Model);
  if(id==='play')model.playing=true;
  if(id==='pause')model.playing=false;
  if(id==='restart')model.revision++;
  if(id==='replace')model.asset=model.asset==='first'?'second':'first';
  if(id==='pose')model.pose=[{node:'hand',position:[0,1,0]}];
  if(id==='clear-pose')model.pose=[];
  ctx.world.touch();show(); // Snapshot before the next frame makes pending adoption explicit.
},{signal:life.signal});
window.modelInspect={read,last:()=>last,keepHandle(){prior=app.services.play.current();},previous:epoch=>prior?.model?.({entity,expectedEpoch:epoch}),dispose(){life.abort();app.dispose();}};
await booted;
