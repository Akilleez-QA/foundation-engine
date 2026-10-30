import {createDependencyLease} from '../../../src/platform/assets/dependency-lease';
(async()=>{
let count=0,done=false;const nodes=Array.from({length:256},(_,i)=>({id:String(i),dependencies:[],bytes:1}));
const d=createDependencyLease({nodes,required:nodes.map(n=>n.id),maxPinnedBytes:256,maxConcurrent:1,acquire:async id=>{count++;return{bytes:1,lease:{value:id,release(){}}};}});
const sentinel=new Promise(r=>setTimeout(()=>r({count,done}),0));await d.prepare(4);done=true;console.log('scheduled-task',await sentinel);d.dispose();
const calls:string[]=[];let release:any;const p=createDependencyLease({nodes:[{id:'optional',dependencies:[],bytes:1},{id:'required',dependencies:[],bytes:1}],required:['required'],maxPinnedBytes:2,maxConcurrent:1,acquire:async id=>{calls.push(id);return id==='optional'?new Promise(r=>{release=r;}):{bytes:1,lease:{value:id,release(){}}};}});
const pending=p.prepare(4);await new Promise(r=>setTimeout(r,0));console.log('required-before-optional-settlement',calls);p.dispose();release?.({bytes:1,lease:{value:0,release(){}}});await pending.catch(()=>{});
})();
