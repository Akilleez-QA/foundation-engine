export declare const STALE_AFTER_MS:number;
export declare const UNOWNED_GRACE_MS:number;
export type LockOwner={pid:number;host?:string;started:string;token?:string};
export declare function pidAlive(pid:number):boolean;
export declare function staleReason(info:LockOwner|null,options?:{now?:number;host?:string;alive?:(pid:number)=>boolean;createdMs?:number}):string|null;
export declare function acquireReleaseLock(lock:string,options?:{now?:()=>number;host?:string;alive?:(pid:number)=>boolean;pid?:number;log?:(message:string)=>void}):()=>void;
