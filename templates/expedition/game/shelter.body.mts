import {defineSystem,createDependencyLease,Name,Shape,Transform,type SceneContext,type DependencyValue,type DependencyBudget,type SceneDefinition,type SceneBody} from '@engine';
import {preparationBudget} from './shared-preparation';
interface PreparedPart {heightAt?(x:number,z:number):number|null}
export function prepareShelter(signal:AbortSignal,acquire?:(id:string,signal:AbortSignal)=>Promise<DependencyValue<PreparedPart>>,budget:DependencyBudget=preparationBudget){
 return createDependencyLease<PreparedPart>({nodes:[{id:'frame',dependencies:[],bytes:128},{id:'contact',dependencies:['frame'],bytes:64},{id:'trim',dependencies:['frame'],bytes:16}],required:['contact'],maxPinnedBytes:208,maxConcurrent:2,signal,budget,
  acquire:acquire??(async(id,ownerSignal)=>{if(ownerSignal.aborted)throw Error('shelter cancelled');return {bytes:id==='frame'?128:id==='contact'?64:16,lease:{value:id==='contact'?{heightAt:(x,z)=>Math.abs(x)<=3&&Math.abs(z)<=3?0:null}:{},release(){}}};})});
}
interface ShelterState {contactReady:boolean;status:ReturnType<typeof prepareShelter>['status'];sharedPinnedBytes:number;sharedOwners:number}
function updateShelterState(ctx:Pick<SceneContext,'state'>,closure:ReturnType<typeof prepareShelter>){
 const budget=preparationBudget.stats,contactReady=!!closure.get('contact'),status=closure.status;
 const previous=ctx.state.shelter as ShelterState|undefined;
 if(previous?.contactReady===contactReady&&previous.status===status&&previous.sharedPinnedBytes===budget.reservedBytes&&previous.sharedOwners===budget.owners)return;
 ctx.state.shelter={contactReady,status,sharedPinnedBytes:budget.reservedBytes,sharedOwners:budget.owners};
}
const prepared=new WeakMap<object,ReturnType<typeof prepareShelter>>();
const visits=new WeakMap<object,{closure:ReturnType<typeof prepareShelter>;remove?:()=>void}>();
export const prepare: NonNullable<SceneDefinition['prepare']> = async (ctx,signal) => {const closure=prepareShelter(signal);await closure.prepare(2);const token={};prepared.set(token,closure);ctx.state.shelterToken=token;updateShelterState(ctx,closure);};
export const enter: NonNullable<SceneDefinition['enter']> = ctx => {const token=ctx.state.shelterToken as object,closure=prepared.get(token);if(!closure)throw Error('missing prepared closure');prepared.delete(token);delete ctx.state.shelterToken;const visit:{closure:ReturnType<typeof prepareShelter>;remove?:()=>void}={closure};visits.set(ctx.world,visit);const height=visit.closure.get('contact')?.heightAt?.(0,0);if(height!==0)throw Error('shelter critical contact unavailable');
  const doc=ctx.view.overlay?.ownerDocument;if(!doc)return;const panel=doc.createElement('section');panel.style.cssText='position:absolute;bottom:12px;left:12px;right:12px;max-width:320px;background:#102431ed;color:white;padding:12px;border-radius:12px;font:500 14px/1.4 system-ui;pointer-events:auto';
  const message=doc.createElement('p');message.textContent=ctx.text('expedition.shelter.ready');const back=doc.createElement('button');back.textContent=ctx.text('expedition.shelter.back');back.style.cssText='min-height:44px;padding:8px 12px';back.onclick=()=>ctx.scene.goto('field');panel.append(message,back);ctx.view.overlay!.append(panel);visit.remove=()=>panel.remove();};
export const exit: NonNullable<SceneDefinition['exit']> = ctx => {const visit=visits.get(ctx.world);visit?.closure.dispose();visit?.remove?.();visits.delete(ctx.world);};
const body: SceneBody = {
 entities:[[Name({name:'floor'}),Transform({y:-.1}),Shape({kind:'box',size:[6,.2,6],color:0x597c82})],[Name({name:'player'}),Transform({y:.6}),Shape({kind:'capsule',size:[.6,1.2,.6],color:0xffce62})]],
 systems:[defineSystem({id:'shelter-owner',run(ctx){const closure=visits.get(ctx.world)?.closure;if(closure){closure.pump(2);updateShelterState(ctx,closure);}if(ctx.input.pressed('expedition-next'))ctx.scene.goto('field');}})],
};
export default body;
