import type {UploadFact} from './window-class';
export const WHOLE_ROUTE_POLICY='whole-scripted-route-v1';
/** Separate workload evidence: never rewrites the diagnostic upload taxonomy. */
export interface ScriptedWindow {
 policy:typeof WHOLE_ROUTE_POLICY;scriptComplete:boolean;complete:boolean;epochBreak:string|null;contextLost:boolean;
 frames:number;elapsedMs:number;durationMs:number;resamples:number;uploads:readonly UploadFact[];
}
export function scriptedWindowProblems(sample:{error?:unknown;classification?:unknown;scriptedWindow?:unknown;frames?:unknown;windowMs?:unknown;uploads?:unknown}):string[]{
 const w=sample.scriptedWindow as Partial<ScriptedWindow>|undefined,problems:string[]=[];
 if(!w||w.policy!==WHOLE_ROUTE_POLICY)return ['missing whole-scripted-route evidence'];
 if(sample.error)problems.push('sample error');
 const kind=(sample.classification as {kind?:string}|undefined)?.kind;
 if(!kind||!['entry','steady','firstUse','unclassified'].includes(kind))problems.push('invalid or missing diagnostic classification');
 if(w.scriptComplete!==true||w.complete!==true||w.epochBreak!==null||w.contextLost!==false)problems.push('incomplete or broken epoch/context guard');
 if(!Number.isInteger(w.frames)||w.frames!<2)problems.push('insufficient frames');
 if(!Number.isFinite(w.durationMs)||w.durationMs!<4000||!Number.isFinite(w.elapsedMs)||w.elapsedMs!<w.durationMs!)problems.push('truncated fixed window');
 if(w.resamples!==0)problems.push('window was resampled');
 if(!Array.isArray(w.uploads)||w.uploads.some(u=>!u||typeof u!=='object'||!Number.isFinite(u.bytes)||u.bytes<0||!Number.isInteger(u.resource)||!Number.isInteger(u.frame)||u.frame<0||u.frame>w.frames!||!Number.isInteger(u.count)||u.count<1||typeof u.firstEver!=='boolean'))problems.push('missing or malformed raw uploads');
 const summary=sample.uploads as Record<string,unknown>|undefined;
 if(sample.frames!==w.frames||sample.windowMs!==Math.round(w.elapsedMs??NaN))problems.push('raw window counters disagree');
 if(!Array.isArray(w.uploads)||!summary||summary.bytes!==w.uploads.reduce((sum,u)=>sum+(u?.bytes??NaN),0))problems.push('raw upload bytes disagree');
 const categories=['initial','recurring','firstUse','unknown'];
 if(!summary||categories.some(k=>!Number.isInteger(summary[k])||Number(summary[k])<0)||categories.reduce((sum,k)=>sum+Number(summary?.[k]),0)!==w.uploads?.length)problems.push('raw upload resource counts disagree');
 return problems;
}
export function isWholeScriptedWindow(sample:Parameters<typeof scriptedWindowProblems>[0]):boolean {
 return sample.scriptedWindow!==undefined&&scriptedWindowProblems(sample).length===0;
}
