import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild,defineGame,defineScene,defineSystem,defineAsset,Name,Transform,Model,ModelAttachment} from '../../../src/author/index.ts';
import {createTestApi} from '../../../src/dev/test-api.ts';
const brief=defineBuild({goal:'Keep optional rigid attachments on the current native pose with explicit failure policies.',genre:'diagnostic',pitch:'Current-pose model attachments.',coreLoop:['Animate','Inspect','Replace'],devices:{targets:['desktop'],minimum:'desktop',input:['keyboard','pointer']},success:[{id:'S1',check:'Rigid geometry follows current affine sockets and stale completions cannot revive retired attachments.',how:'playtest',by:'scripts/play/model-attachment-check.mjs'}]});
const game=defineGame({id:'model-attachment',version:'0.1.0',title:'Model attachments',firstScene:'sample'});
const names=['parent','missing','slow-parent','slow-exit','rigid','tail'];
const assets=names.map(id=>defineAsset({id,type:'model',url:`/__model-attachment/${id}.glb`,licence:'CC0-1.0',author:'Foundation Engine contributors',source:'templates/mechanics/assets/generate-fixture.mjs'}));
const c=Math.SQRT1_2,offset=[c,c,0,0,-c,c,0,0,0,0,1,0,.4,.1,0,1];
let ctx,parent,child,tail,life,retired=true,models,prior;
const attach=(entity,anchor,socket,offset,unavailable='hide')=>ctx.world.add(entity,ModelAttachment({parent:anchor,socket,offset,unavailable,inheritVisibility:true}));
const bind=()=>{attach(child,parent,'hand',offset,document.querySelector('#policy').value);attach(tail,child,'tip',[1,0,0,0,0,1,0,0,0,0,1,0,.2,0,0,1]);};
const inspect=entity=>window.engine.model({entity,expectedEpoch:window.engine.state().scene?.epoch??0,sockets:entity===parent?['hand']:['tip'],maxNodes:64});
const read=()=>({retired,entities:{parent,child,tail},resources:models?.stats(),models:ctx?Object.fromEntries([['parent',parent],['child',child],['tail',tail]].map(([name,e])=>[name,{resource:ctx.modelState(e),attachment:ctx.modelAttachmentState(e),transform:{...ctx.world.get(e,Transform)},inspection:retired?null:inspect(e)}])):null});
const show=()=>{document.querySelector('#state').textContent=JSON.stringify(read(),null,2);};
const commands={
  inspect:show,
  play(){ctx.world.get(parent,Model).playing=true;},
  pause(){ctx.world.get(parent,Model).playing=false;},
  move(){ctx.world.get(parent,Transform).x+=.4;},
  replace(){ctx.world.get(parent,Model).asset=document.querySelector('#asset').value;},
  attach:bind,
  detach(){ctx.world.remove(child,ModelAttachment);},
  cycle(){attach(parent,child,'tip');},
  'clear-cycle'(){ctx.world.remove(parent,ModelAttachment);},
  pose(){ctx.world.get(parent,Model).pose=[{node:'hand',position:[0,.9,0]}];},
  'clear-pose'(){ctx.world.get(parent,Model).pose=[];},
};
const frame=defineSystem({id:'attachment-diagnostic',phase:'frame',run(){}});
const scene=defineScene({id:'sample',title:'Native attachment comparison',systems:[frame],view:{camera:{position:[2.8,2.6,4.5],target:[.1,.8,0],fov:42},background:0x243347},enter(context){
  ctx=context;retired=false;life=new AbortController();
  // Allocate dependents first to exercise ordering independent of numeric entity IDs.
  child=ctx.world.spawn(Name({name:'rigid-child'}),Transform({x:1.4}),Model({asset:'rigid',playing:false}));
  tail=ctx.world.spawn(Name({name:'rigid-tail'}),Transform({x:1.8}),Model({asset:'tail',playing:false}));
  parent=ctx.world.spawn(Name({name:'animated-parent'}),Transform({x:-.6}),Model({asset:'parent',clip:'pulse',playing:false}));bind();
  for(const [id,fn]of Object.entries(commands))document.getElementById(id).addEventListener('click',()=>{fn();ctx.world.touch();show();},{signal:life.signal});
  document.querySelector('#policy').addEventListener('change',()=>{bind();ctx.world.touch();},{signal:life.signal});
},exit(){retired=true;life.abort();}});
const compiled=compileGame({brief,game,defs:[scene,frame,...assets]});
const app=createApp([...layerModules(game,brief),...compiled.modules],{mode:'test',flag:id=>appFeatures().enabled(id),probes:true});
const booted=app.boot();window.engine=createTestApi(app,booted);
window.modelAttachment={read,show,keepContext(){prior={ctx,child};},previous(){return prior?.ctx.modelAttachmentState(prior.child);},resources:()=>models?.stats(),queryRepeated(){for(let i=0;i<100;i++)ctx.modelAttachmentState(child);},dispose(){app.dispose();}};
await booted;models=app.services.models;
