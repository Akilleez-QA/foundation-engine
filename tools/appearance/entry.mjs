import '../../src/app/styles.ts';
import '../authoring/style.css';
import {createApp} from '../../src/core/app.ts';
import {appFeatures} from '../../src/core/settings/app-features.ts';
import {layerModules} from '../../src/app/layer-modules.ts';
import {compileGame} from '../../src/author/compile.ts';
import {defineBuild,defineGame,defineScene,defineSaveSection,defineSystem} from '../../src/author/index.ts';
import {createTestApi} from '../../src/dev/test-api.ts';
import {createAppearanceDocument} from '../../src/kits/character/appearance.ts';
import {createAuthoringSession} from '../../src/kits/authoring/index.ts';
import {saveModule} from '../../src/core/save/module.ts';
import {browserPort} from '../../src/core/save/storage-port.ts';
import {initial,limits,compatible,storageKey} from './schema.mjs';
import {createProjection} from './projection.mjs';

const intake = value => createAppearanceDocument({id:'appearance',json:JSON.stringify(value),version:1,limits,validate:compatible});
const section = defineSaveSection({id:'appearance.profile',scope:'device',initial,parse(value) {
  const d=intake(value); const result=d.read().value; d.dispose(); return result;
}});
const brief=defineBuild({goal:'Compare creator-defined appearance edits before accepting and saving them.',genre:'diagnostic',
  pitch:'Optional desktop appearance tooling.',coreLoop:['Select','Preview','Commit','Save'],
  devices:{targets:['desktop'],minimum:'desktop',input:['keyboard','pointer']},
  success:[{id:'S1',check:'Preview, cancellation, history and saved reload preserve accepted appearance.',how:'playtest',by:'scripts/play/appearance-check.mjs'}]});
const game=defineGame({id:'appearance-preview',version:'0.1.0',title:'Appearance preview',firstScene:'sample'});
const local=browserPort('local'); let denyWrites=false;
const port={...local,set(key,value){if(denyWrites&&key===storageKey)throw Error('Injected storage rejection');local.set(key,value);}};
let documentOwner,session,projection,handle,blocked=false,retired=false,message='Change a form, then preview it.';
let observedSaveStatus;
// Accepted page-session data survives scene reentry; explicit Reload Saved discards it.
let acceptedSession;
let abort;
const el=id=>document.getElementById(id);
const snapshot=()=>documentOwner.read();
const feedback=()=>{
  const status=handle.status(), matches=JSON.stringify(handle.get())===snapshot().json;
  let exists=false;try {exists=port.get(storageKey)!==null;}catch{}
  if(status==='saved')return matches?(exists?'Saved locally':'Not saved yet'):'Unsaved changes';
  return `Unsaved · ${status}`;
};
const state=()=>({value:snapshot().value,preview:session.readPreview()?.value??null,history:session.stats(),blocked,retired,message,persistence:feedback()});
const render=()=>{
  observedSaveStatus=handle.status();
  const s=state();el('message').textContent=message;el('persistence').textContent=s.persistence;
  el('commit').disabled=blocked||!s.preview;el('preview').disabled=blocked;el('save').disabled=blocked||handle.status()==='newer';
  el('undo').disabled=blocked||s.history.cursor===0;el('redo').disabled=blocked||s.history.cursor===s.history.entries;
  el('recover').disabled=!blocked;
};
const cancel=()=>{session.cancel();projection.clearPreview();};
const reconcile=()=>{try{projection.apply(snapshot().value);blocked=false;}catch(error){blocked=true;message=`View needs recovery: ${error.message}`;}};
const editable=()=>{if(blocked)throw Error('Rebuild the view before editing.');};
const publish=operation=>{editable();const r=operation();message=`Edit ${r.status}.`;if(r.status==='accepted')reconcile();};
const command=operation=>()=>{if(retired)return;try{operation();}catch(error){message=error.message;}render();};
const commands={
  preview:command(()=>{
    editable();cancel();const scale=el('scale').value===''?NaN:Number(el('scale').value);
    const value={version:1,parts:{form:el('form').value},parameters:{scale,tint:parseInt(el('tint').value.slice(1),16)}};
    if(!compatible(value))throw Error('Enter a scale from 0.5 to 1.5. Accepted appearance is unchanged.');
    const r=session.preview(snapshot().ticket,()=>JSON.stringify(value));
    if(r.status==='prepared'){try{projection.preview(r.candidate.value);}catch(error){cancel();throw error;}}
    message=r.status==='prepared'?'Preview ready. Commit or Cancel.':`Preview ${r.status}.`;
  }),
  cancel:command(()=>{cancel();message='Preview cancelled.';}),
  commit:command(()=>publish(()=>session.commit())),
  undo:command(()=>{cancel();publish(()=>session.undo());}),
  redo:command(()=>{cancel();publish(()=>session.redo());}),
  save:command(()=>{editable();handle.update(draft=>Object.assign(draft,structuredClone(snapshot().value)),{now:true});message='Save attempted; see storage status.';}),
  recover:command(()=>{cancel();reconcile();if(!blocked)message='View rebuilt from accepted appearance.';}),
  reload:()=>location.reload(),
};
// Observe the existing save owner cheaply; touch DOM only when its status changes.
const sync=defineSystem({id:'appearance-sync',phase:'frame',run(){if(handle&&!retired&&handle.status()!==observedSaveStatus)render();}});
const scene=defineScene({id:'sample',title:'Appearance preview',systems:[sync],view:{camera:{position:[0,4,8],target:[0,0,0],fov:45},background:0x182332},
  enter(ctx){
    abort=new AbortController();retired=false;blocked=false;message='Change a form, then preview it.';
    handle=ctx.save(section);documentOwner=intake(acceptedSession??handle.get());session=createAuthoringSession(documentOwner,{maxEntries:16,maxHistoryBytes:32768});projection=createProjection(ctx.world);reconcile();
    for(const [id,fn]of Object.entries(commands))el(id).addEventListener('click',fn,{signal:abort.signal});
    for(const id of ['form','scale','tint'])el(id).addEventListener('input',command(()=>{cancel();message='Form changed. Preview again before committing.';}),{signal:abort.signal});
    const v=snapshot().value;el('form').value=v.parts.form;el('scale').value=String(v.parameters.scale);el('tint').value='#'+v.parameters.tint.toString(16).padStart(6,'0');render();
  },
  exit(){retired=true;acceptedSession=documentOwner?.read().value;const errors=[];for(const fn of [()=>abort.abort(),()=>session?.dispose(),()=>documentOwner?.dispose(),()=>projection?.dispose()])try{fn();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Appearance cleanup');},
});
const compiled=compileGame({brief,game,defs:[scene,section,sync]});
const modules=layerModules(game,brief).map(m=>m.id==='core.save'?saveModule({namespace:game.id,build:'appearance-preview@0.1.0',storage:()=>({local:port,session:browserPort('session')})}):m);
const app=createApp([...modules,...compiled.modules],{mode:'test',flag:id=>appFeatures().enabled(id),probes:true});
const booted=app.boot();window.engine=createTestApi(app,booted);
window.appearance={state,world:()=>projection?.inspect(),commands,failure(kind){if(kind==='projection')projection.failNext();else if(kind==='storage')denyWrites=true;else if(kind==='restore-storage')denyWrites=false;else throw Error('Unknown failure');},dispose(){app.dispose();}};
await booted;
