// Exclusive production-release lock shared by every worktree (lives in --git-common-dir).
// Fail-closed: age never proves that a recorded owner has stopped releasing.
import {mkdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
export const STALE_AFTER_MS=6*60*60*1000;
/** Owner without a readable owner.json may be mid-acquire; give it this long before treating it as abandoned. */
export const UNOWNED_GRACE_MS=10*60*1000;
export function pidAlive(pid){try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
function owner(dir){try{return JSON.parse(readFileSync(path.join(dir,'owner.json'),'utf8'));}catch{return null;}}
/** Why an existing lock may be reclaimed, or null while it must be respected. */
export function staleReason(info,{now=Date.now(),host=hostname(),alive=pidAlive,createdMs=now}={}){
 if(!info)return now-createdMs>UNOWNED_GRACE_MS?`it has no owner record and is ${Math.round((now-createdMs)/60000)} min old`:null;
 if(info.host===host&&Number.isInteger(info.pid)&&info.pid>0&&!alive(info.pid))return `owner pid ${info.pid} on ${host} is no longer running`;
 return null;
}
/** Takes the lock or throws a readable error naming the holder. Returns a release function. */
export function acquireReleaseLock(lock,{now=Date.now,host=hostname(),alive=pidAlive,pid=process.pid,log=console.error}={}){
 const take=()=>{
  const token=randomUUID();
  mkdirSync(lock);
  writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid,host,token,started:new Date(now()).toISOString()}));
  // An old callback must never remove a successor's lock, including a repeat release.
  return ()=>{if(owner(lock)?.token===token)rmSync(lock,{recursive:true,force:true});};
 };
 try{return take();}catch(error){if(error.code!=='EEXIST')throw error;}
 const held=owner(lock);let createdMs=now();try{createdMs=statSync(lock).mtimeMs;}catch{}
 const reason=staleReason(held,{now:now(),host,alive,createdMs});
 if(!reason)throw Error(`Another production release holds ${lock} (${held?`pid ${held.pid} on ${held.host??'unknown host'} since ${held.started}`:'owner record not written yet'}). Wait for it to finish; remove the directory by hand only if you are sure it is abandoned.`);
 // Move the stale lock aside atomically so two reclaimers cannot both succeed.
 const aside=`${lock}.stale-${pid}-${now()}`;
 try{renameSync(lock,aside);}catch{throw Error(`Could not reclaim the stale release lock ${lock}; another release may have just taken it.`);}
 if(JSON.stringify(owner(aside))!==JSON.stringify(held)){try{renameSync(aside,lock);}catch{}throw Error(`Release lock ${lock} changed while reclaiming it; not continuing.`);}
 rmSync(aside,{recursive:true,force:true});log(`Reclaimed stale release lock: ${reason}.`);
 return take();
}
