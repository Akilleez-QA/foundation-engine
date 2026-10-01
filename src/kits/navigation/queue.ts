import {createPathSearch,prepareNavigationGraph,type NavigationGraph,type PathResult,type PathSearch} from './search';
export interface RouteRequest {id:string;owner:string;generation:number;graph:NavigationGraph;start:string;goal:string}
/** FIFO admission and round-robin logical work. No timers, worker pool or second frame loop. */
export function createRouteQueue(options:{maxRequests:number;maxNodes:number}){
 if(![options.maxRequests,options.maxNodes].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('navigation: invalid queue limits');
 const limits={...options},requests=new Map<string,{request:RouteRequest;sourceGraph:NavigationGraph;search:PathSearch}>(),generations=new Map<string,number>();let nodes=0,closed=false;
 return {
  offer(input:RouteRequest):'accepted'|'stale'|'duplicate'|'conflict'|'saturated'|'closed'{
   if(closed)return 'closed';
   if(!input.id||!input.owner||!Number.isSafeInteger(input.generation)||input.generation<0)throw Error('navigation: invalid request identity');
   const generation=generations.get(input.owner);
   if(generation!==undefined&&input.generation<generation)return 'stale';
   // Duplicate identity uses the source; all search/accounting uses its admitted snapshot.
   const admitted=requests.get(input.id),previous=admitted?.request;if(previous)return previous.owner===input.owner&&previous.generation===input.generation&&admitted!.sourceGraph===input.graph&&previous.start===input.start&&previous.goal===input.goal?'duplicate':'conflict';
   const retiring=generation!==undefined&&input.generation>generation?[...requests.values()].filter(r=>r.request.owner===input.owner):[];
   const freedNodes=retiring.reduce((sum,r)=>sum+r.request.graph.nodes.length,0);
   // Admission precedes path record allocation. The graph is prepared outside this queue.
   if(requests.size-retiring.length>=limits.maxRequests||input.graph.nodes.length>limits.maxNodes-nodes+freedNodes)return 'saturated';
   if(!generations.has(input.owner)&&generations.size>=limits.maxRequests)return 'saturated';
   const graph=prepareNavigationGraph(input.graph),search=createPathSearch(graph,input.start,input.goal);
   if(generation!==undefined&&input.generation>generation)for(const [id,r]of requests)if(r.request.owner===input.owner){r.search.cancel();nodes-=r.request.graph.nodes.length;requests.delete(id);}
   generations.set(input.owner,input.generation);requests.set(input.id,{request:{...input,graph},sourceGraph:input.graph,search});nodes+=graph.nodes.length;return 'accepted';
  },
  pump(maxWork:number):number{
   if(!Number.isSafeInteger(maxWork)||maxWork<0)throw Error('navigation: invalid queue work');
   let used=0,idle=0;
   while(used<maxWork&&requests.size&&idle<requests.size){const [id,r]=requests.entries().next().value!;requests.delete(id);requests.set(id,r);
    if(r.search.result.status!=='pending'){idle++;continue;}idle=0;used+=r.search.step(1).work;
   }return used;
  },
  result(id:string):PathResult|null{return requests.get(id)?.search.result??null;},
  release(id:string){const r=requests.get(id);if(!r)return;r.search.cancel();nodes-=r.request.graph.nodes.length;requests.delete(id);},
  cancelOwner(owner:string,generation:number){for(const [id,r]of requests)if(r.request.owner===owner&&r.request.generation===generation){r.search.cancel();nodes-=r.request.graph.nodes.length;requests.delete(id);}},
  dispose(){if(closed)return;closed=true;for(const r of requests.values())r.search.cancel();requests.clear();generations.clear();nodes=0;},
  get stats(){return {requests:requests.size,nodes,owners:generations.size};},
 };
}
