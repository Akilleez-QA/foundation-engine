import {controlsSettingsModule} from '../../../src/platform/input/controls-settings-module.ts';
// Real engine composition for browser regression evidence; not shipped by a template.
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appBus} from '../../../src/core/app-events.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild,defineGame,defineScene,defineSystem,defineEntity,defineInput,Name,Transform,Shape,projectToView,measureUiOcclusion} from '../../../src/author/index.ts';
import {hud,ui} from '../../../src/kits/ui/index.ts';
import {shellModule} from '../../../src/platform/ui/shell-module.ts';
import {sceneId} from '../../../src/author/ids.ts';
import {installGraphicsButton} from '../../../src/platform/ui/graphics-button.ts';
import {appLoop} from '../../../src/platform/ui/runtime.ts';
import {appActivities,appLayers} from '../../../src/platform/ui/runtime.ts';

const brief=defineBuild({goal:'Exercise optional HUD disclosure and owned reading sheets.',genre:'diagnostic',pitch:'Inspect owned reading panels without losing gameplay state.',coreLoop:['Open details','Read','Close and resume'],
 devices:{targets:['phone','tablet','desktop'],minimum:'phone',input:['keyboard','pointer','touch','gamepad']},success:[{id:'S1',check:'Reading panel pauses and restores the scene',how:'playtest',by:'scripts/play/hud-check.mjs'}]});
const game=defineGame({id:'hud-check',version:'0.1.0',title:'HUD lifecycle diagnostic',firstScene:'sample',kits:[ui()],strings:{en:{
 'game.hint.summary':'{action}: {keys} / {pad}', 'game.hint.keyI':'I', 'game.hint.keyU':'U', 'game.hint.west':'West face button', 'game.hint.north':'North face button',
 'game.hud.long':'Additional information about this activity','game.hud.label':'Details','game.hud.close':'Close details','game.hud.essential':'Essential state: ready',
 'game.hud.detail':'Secondary information stays available without covering the active view. Long text must reflow and remain readable.',
}}});
const shellMode=new URLSearchParams(location.search).get('shell');
let context;
let observedView = null;
let sizeNotifications = 0;
const observeView = ctx => ctx.view.observeSize(({width, height}) => {
 observedView = {width, height, notifications:++sizeNotifications};
});
const mode=new URLSearchParams(location.search).get('layout')??'disclose';
const present=mode=>hud(context).present(mode==='inline'?{mode:'inline'}:{mode:'disclose',label:context.text('game.hud.label'),closeLabel:context.text('game.hud.close')});
const action=defineInput({id:'hud-details',label:'Show details',keys:['code:KeyI'],pad:['y']});
const touchAction=new URLSearchParams(location.search).has('touch-sources') ? defineInput({id:'touch-check',label:'Touch diagnostic action',keys:['code:KeyT'],pad:['lb']}) : null;
const move=defineInput({id:'move',label:'Move',axis:{negative:{keys:['code:ArrowLeft'],pad:['dpad-left']},positive:{keys:['code:ArrowRight'],pad:['dpad-right']}}});
const cube=defineEntity({id:'subject',components:[Name({name:'subject'}),Transform({y:0.5}),Shape({kind:'box',size:[1,1,1],color:0x4f8cff})]});
const update=defineSystem({id:'animate',phase:'frame',run(ctx,dt){
 ctx.state.frames=(ctx.state.frames??0)+1;ctx.state.simTime=(ctx.state.simTime??0)+dt;
 if(touchAction && ctx.input.pressed('touch-check'))ctx.state.touchPresses=(ctx.state.touchPresses??0)+1;
 if(ctx.input.pressed('hud-details'))hud(ctx).details(true);
 ctx.state.move=ctx.input.axis('move');
 for(const [,tr]of ctx.world.query(Transform)){tr.ry+=dt*.2;tr.x+=ctx.state.move*dt;ctx.world.touch();}
}});
const sample=defineScene({id:'sample',title:'Reading sheet diagnostic',entities:[cube],systems:[update],
 view:{camera:{position:[3,3,5],target:[0,.5,0]},background:0x141a24},enter(ctx){context=ctx;observeView(ctx);
 if(shellMode)return;
 hud(ctx).line('essential',ctx.text('game.hud.essential'));
 for(let i=0;i<12;i++)hud(ctx).line(`detail-${i}`,`${i+1}. ${Array(4).fill(ctx.text('game.hud.detail')).join(' ')}`,{importance:'detail'});
 if(mode==='profiles')hud(ctx).layout({select:({width})=>width<700?{mode:'disclose',label:ctx.text('game.hud.label'),closeLabel:ctx.text('game.hud.close')}:{mode:'inline'}});
 else present(mode);
}});
const other=defineScene({id:'other',title:'Other',enter(ctx){context=ctx;observeView(ctx);}});
const savedControls=new URLSearchParams(location.search).get('savedControls')==='player';
const compiled=compileGame({brief,game,defs:[sample,other,action,move,...(touchAction?[touchAction]:[])]});
export const app=createApp([...layerModules(game,brief).map(module=>shellMode&&module.id==='platform.shell'?shellModule({home:sceneId(game.firstScene),menuPresentation:shellMode==='compact'?'compact':'expanded'}):module),...compiled.modules,...(savedControls?[controlsSettingsModule({id:'diagnostic.controls',scope:'player'})]:[])],{mode:'test',events:appBus,flag:id=>appFeatures().enabled(id),probes:true});
window.hudCheck={
 state:()=>({observedView:observedView&&{...observedView},world:app.probes.read('world'),layers:appLayers().stack().length,activities:appActivities().running().length,pool:app.probes.read('render.pool'),focus:document.activeElement?.textContent}),
 measure:()=>{const canvas=document.querySelector('#app canvas').getBoundingClientRect(),projected=projectToView(context.view,[0,.5,0]);
 const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 const target={x:canvas.x+(projected.x+1)*canvas.width/2-32,y:canvas.y+(1-projected.y)*canvas.height/2-32,width:64,height:64};
 const footprints=[...document.querySelectorAll('.hud-lines, .hud-details-trigger')].filter(element=>element.getClientRects().length>0).map(rect);
 return {target,footprints,report:measureUiOcclusion(rect(document.querySelector('#app canvas')),footprints,[target])};},
 presentLong:()=>hud(context).present({mode:'disclose',label:context.text('game.hud.long'),closeLabel:context.text('game.hud.close')}),
 pad:(input,down)=>app.services.input.pad(input,down),present,details:open=>hud(context).details(open),removeDetails:()=>{for(let i=0;i<12;i++)hud(context).line(`detail-${i}`,null);},
 goto:id=>context.scene.goto(id),dispose:()=>app.dispose(),
};
window.hudBoot=app.boot().then(()=>{if(shellMode)installGraphicsButton(async button=>{const {installGraphicsScreen}=await import('../../../src/platform/ui/graphics-screen.ts');return installGraphicsScreen({quality:app.services.quality,layers:appLayers(),loop:appLoop(),button});});});

export const sceneContext=()=>context;
