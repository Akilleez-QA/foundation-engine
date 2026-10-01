import '../../src/app/styles.ts';
import './style.css';
import {createApp} from '../../src/core/app.ts';
import {appFeatures} from '../../src/core/settings/app-features.ts';
import {layerModules} from '../../src/app/layer-modules.ts';
import {compileGame} from '../../src/author/compile.ts';
import {defineBuild,defineGame,defineScene,defineSaveSection,defineSystem,defineEntity,Name,Transform,Shape} from '../../src/author/index.ts';
import {createTestApi} from '../../src/dev/test-api.ts';
import {saveModule} from '../../src/core/save/module.ts';
import {browserPort} from '../../src/core/save/storage-port.ts';
import {createWorkbenchController,createWorkbenchStoragePort,sectionDefinition,storageKey} from './controller.mjs';
const section=defineSaveSection({...sectionDefinition,initial:sectionDefinition.initial()});
// Preserve the explicit bounded storage contract supplied by the finite controller.
section.section=sectionDefinition;
const brief=defineBuild({goal:'Inspect authored allocation and coherent accepted consequences with truthful persistence.',genre:'diagnostic',pitch:'Optional desktop allocation workbench.',coreLoop:['Inspect','Preview','Accept','Restore'],devices:{targets:['desktop'],minimum:'desktop',input:['keyboard','pointer']},success:[{id:'S1',check:'Coupled acceptance, refusal, source retention and persistence are observable.',how:'playtest',by:'scripts/play/progression-workbench-check.mjs'}]});
const game=defineGame({id:'progression-workbench',version:'0.1.0',title:'Allocation workbench',firstScene:'sample'});
const local=createWorkbenchStoragePort(browserPort('local')),failureKey='workbench-diagnostic-refuse-write';
const port={...local,set(key,value){if(key===storageKey&&sessionStorage.getItem(failureKey)==='yes')throw Error('Intentional workbench storage rejection');local.set(key,value);}};
const el=id=>document.getElementById(id),json=value=>JSON.stringify(value,null,2);
let openError='',controller,context,life,sheet=null,prepared=null,lastResult=null,lastSignature='',visits=0,frames=0,message='';
function render(){
 if(!controller)return;const s=controller.read();
 el('compact-status').textContent=openError?`Cannot open details: ${openError}`:s.blocked?'Saved document needs recovery':`Accepted revision ${s.envelope?.revision??0} · ${s.durable?'Saved locally':'Not durable'} · Details are optional`;
 if(!el('details'))return;
 el('accepted').textContent=json(s.envelope);
 el('sources').textContent=json(s.view?.grants??[]);
 el('trace').textContent=json({trace:s.view?.trace,resources:s.view?.resources??s.envelope?.resources});
 const selected=s.view?.skills?.find(row=>row.id===el('choice').value);
 el('eligibility').textContent=json(selected??{status:'unavailable'});
 el('preview').textContent=prepared?json({label:prepared.baseRevision===s.envelope.revision?'Prepared only — not accepted':'Stale preview — Accept will check its ticket and refuse; discard to prepare again',request:prepared.request,baseRevision:prepared.baseRevision,acceptedRevision:s.envelope.revision,view:prepared.view}):'No preview.';
 el('persistence').textContent=s.blocked?`Editing refused · ${s.saveStatus}`:s.durable?'Saved locally':`Accepted in session · not durable (${s.saveStatus})`;
 el('message').textContent=message||s.message||'';
 el('commit').disabled=!prepared||s.blocked||s.retired;el('cancel').disabled=!prepared;
 for(const id of ['learn','surrender','free','voucher','earn','use','fraction','save'])el(id).disabled=!!s.blocked||s.retired;
 el('fail-storage').checked=sessionStorage.getItem(failureKey)==='yes';
}
function command(payload){return{epoch:controller.read().envelope.epoch,id:crypto.randomUUID(),payload};}
function act(fn){try{lastResult=fn();message=json(lastResult?.status?{status:lastResult.status,reason:lastResult.reason}:lastResult);}catch(error){lastResult={status:'exception',reason:error.message};message=error.message;}render();}
function preview(kind){act(()=>{if(prepared)controller.cancel(prepared.candidate);prepared=null;const request=command({kind,skill:el('choice').value}),baseRevision=controller.read().envelope.revision;const result=controller.preview(request);if(result.status==='prepared')prepared={...result,request,baseRevision};return result;});}
function support(payload){act(()=>{const result=controller.preview(command(payload));return result.status==='prepared'?controller.commit(result.candidate):result;});}
async function open(){
 if(sheet||!context)return;openError='';
 const fragment=document.importNode(el('details-template').content,true),element=fragment.querySelector('#details');
 try{
  sheet=context.view.openReadingSheet({id:'allocation-details',element,initialFocus:()=>el('choice'),returnFocus:()=>el('open')});
  const opened=sheet;opened.signal.addEventListener('abort',()=>{if(prepared){controller.cancel(prepared.candidate);prepared=null;}if(sheet===opened)sheet=null;},{once:true});
  await opened.ready;if(opened.signal.aborted)return;
  const bind=(id,fn)=>el(id).addEventListener('click',fn,{signal:opened.signal});
  bind('close',()=>opened.close());bind('learn',()=>preview('learn'));bind('surrender',()=>preview('surrender'));
  bind('commit',()=>act(()=>{const result=controller.commit(prepared.candidate);prepared=null;return result;}));
  bind('cancel',()=>act(()=>{const result=controller.cancel(prepared.candidate);prepared=null;return result;}));
  for(const [id,payload] of Object.entries({free:{kind:'free'},voucher:{kind:'voucher'},earn:{kind:'earn',amount:5},use:{kind:'adjust',resource:'capacity',delta:-1},fraction:{kind:'adjust',resource:'continuous',delta:-.125}}))bind(id,()=>support(payload));
  bind('save',()=>act(()=>controller.save()));bind('reload',()=>location.reload());
  el('choice').addEventListener('change',()=>{if(prepared){controller.cancel(prepared.candidate);prepared=null;message='Selection changed; previous candidate discarded.';}render();},{signal:opened.signal});
  el('fail-storage').addEventListener('change',()=>{sessionStorage.setItem(failureKey,el('fail-storage').checked?'yes':'no');render();},{signal:opened.signal});render();
 }catch(error){openError=error.message;message=error.message;sheet=null;render();}
}
const subject=defineEntity({id:'subject',components:[Name({name:'subject'}),Transform({y:.8}),Shape({kind:'box',size:[1.5,1.5,1.5],color:0x78d9c3})]});
const ground=defineEntity({id:'ground',components:[Transform({y:-.1}),Shape({kind:'box',size:[8,.2,8],color:0x354e6a})]});
const system=defineSystem({id:'world-pulse',phase:'frame',run(ctx){frames++;const t=ctx.world.get(ctx.named('subject'),Transform);if(t)t.y=.8+Math.sin(ctx.time.t)*.12;}});
const scene=defineScene({id:'sample',title:'Allocation workbench',systems:[system],entities:[subject,ground],view:{camera:{position:[5,4,6],target:[0,.6,0]},background:0x142032},enter(ctx){
 context=ctx;life=new AbortController();visits++;controller=createWorkbenchController({saveHandle:ctx.save(section),hasEnvelope:()=>port.get(storageKey)!==null,readPersisted:()=>port.get(storageKey)});
 prepared=null;message='';el('open').addEventListener('click',open,{signal:life.signal});render();
 // Owned UI scheduling also observes save-status-only transitions while the scene is covered.
 const timer=setInterval(()=>{const s=controller.read(),signature=json({revision:s.envelope?.revision,status:s.saveStatus,durable:s.durable,blocked:s.blocked});if(signature!==lastSignature){lastSignature=signature;render();}},150);
 life.signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
 },exit(){life?.abort();sheet?.close();sheet=null;controller?.dispose();context=null;}});
const compiled=compileGame({brief,game,defs:[scene,section,system]});
const modules=layerModules(game,brief).map(m=>m.id==='core.save'?saveModule({namespace:game.id,build:'progression-workbench@0.1.0',storage:()=>({local:port,session:browserPort('session')})}):m);
const app=createApp([...modules,...compiled.modules],{mode:'test',flag:id=>appFeatures().enabled(id),probes:true});
const booted=app.boot();window.engine=createTestApi(app,booted);
window.workbench={read:()=>controller?.read(),ui:()=>({message,openError,lastResult,preview:prepared?{status:prepared.status,request:prepared.request,baseRevision:prepared.baseRevision,view:prepared.view}:null,visits,frames,sheet:!!sheet}),retirePreview(){const old=controller,p=prepared;old.dispose();return p?old.commit(p.candidate):null;},dispose(){app.dispose();}};
await booted;
