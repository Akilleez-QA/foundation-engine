import {createDependencyLease,type SceneContext,type DependencyBudget} from '@engine';
import {preparationBudget} from './shared-preparation';
import {createFrames} from '@kits/frames';
import {definePortal,crossPortal,createPortalGraph} from '@kits/navigation';
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
/** Small critical contact/frame closure; the same acquire seam accepts existing asset leases/worker results. */
export function createDoorway(budget:DependencyBudget=preparationBudget){
 const frames=createFrames();let open=true;
 const closure=createDependencyLease<{kind:string}>({nodes:[{id:'frame',dependencies:[],bytes:128},{id:'contact',dependencies:['frame'],bytes:64},{id:'trim',dependencies:['frame'],bytes:16}],required:['contact'],maxPinnedBytes:208,maxConcurrent:1,budget,
  acquire:async(id,signal)=>{if(signal.aborted)throw Error('doorway cancelled');if(id==='frame')frames.set({id:'field-door',generation:1,matrix});return {bytes:id==='frame'?128:id==='contact'?64:16,lease:{value:{kind:id},release(){if(id==='frame')frames.remove({id:'field-door',generation:1});}}};}});
 const base=definePortal({id:'field-door',revision:1,from:{frame:{id:'field-door',generation:1},position:[0,0,2]},to:{frame:{id:'field-door',generation:1},position:[0,0,0]},width:1.6,height:2.4,open:true});
 closure.pump(3);
 return {graph(nodes:readonly {id:string;edges:readonly {to:string;cost:number}[]}[]){return createPortalGraph(nodes.map(n=>({...n,edges:n.edges.map(e=>({...e,...(n.id==='approach'&&e.to==='door'?{portal:{...base,open}}:{})}))})),{radius:.3,height:1.2},frames);},pump(ctx:SceneContext){closure.pump(4);ctx.state.doorway={ready:closure.status==='ready'||closure.status==='partial',state:closure.status,open,pinnedBytes:closure.stats.reservedBytes,sharedPinnedBytes:budget.stats.reservedBytes,sharedOwners:budget.stats.owners};},
  cross(){return crossPortal({...base,open},1,{radius:.3,height:1.2},frames,()=>!!closure.get('contact'),()=>open);},
  setOpen(value:boolean){open=value;},dispose(){closure.dispose();},};
}
