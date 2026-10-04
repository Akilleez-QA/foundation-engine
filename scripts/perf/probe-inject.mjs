// The bench's page probe installed as an init script (page.addInitScript) before the app loads.
// It wraps the WebGL prototypes only inside the muted, isolated bench browser (bench-browser.mjs); the game itself is never changed.
//
// - Draws, triangles and off-screen (framebuffer) draws; the largest off-screen burst in one frame is the shadow pass.
// - Off-screen passes: a run of off-screen draws into one framebuffer and viewport (a bind or a viewport change starts
//   a new one). Each shadow-map face is one pass (a sun or spot map 1 each, a point light's packed map 6); passes that
//   draw nothing are not counted. The most in one frame is `shadowPassesMax`.
// - The GL upload ledger: live texture bytes per texture object (unknown formats count 4 bytes per texel, mips +1/3).
// - The canvas census: every live canvas and OffscreenCanvas, page-wide.
// - ADR 0051 submission counters: useProgram, programs linked, uniform* calls, bindVertexArray, bufferSubData,
//   texture uploads. three's program lookups need a hook inside three and stay UNMEASURED (null).
// - ADR 0053 upload records: per texture object in a window, its bytes, first frame, count and whether it had ever
//   been uploaded before the window.
// - A per-frame monitor: during a window it records each frame's interval and draw deltas.
// - The scene guard: a window tags the scene element; the end check needs the same hash, no hashchange and
//   the same connected element (a same-hash re-entry remounts the scene).
export const windowFinished = (win, elapsed) =>
  !win.scriptPending &&
  ((win.target > 0 && win.rendered >= win.target && elapsed >= win.minMs) || elapsed >= win.maxMs);
export const PROBE = `(()=>{
 const windowFinished=${windowFinished.toString()};
 const W=window;W.__draws=0;W.__tris=0;W.__off=0;W.__passes=0;let passOpen=false;W.__texLive=new Map();W.__canv=[];W.__hashChanges=0;
 const C=W.__count={useProgram:0,programsCreated:0,uniformCalls:0,bindVertexArray:0,bufferSubData:0,textureUploads:0};
 addEventListener('hashchange',()=>{W.__hashChanges++;W.__offMax=0;W.__passMax=0;});
 const fb=new WeakMap(),unit=new WeakMap(),bound=new WeakMap(),bytesOf=new WeakMap(),texId=new WeakMap(),texUps=new WeakMap();
 let nextTex=1;const ctxs=W.__ctxs=[];
 const bppFmt={6408:4,6407:3,6403:1,33319:2,6409:1,6410:2,6406:1,6402:4,34041:4};
 const bppType={5121:1,5126:4,36193:2,5131:2,5123:2,5125:4,34042:4};
 const bppInt={32856:4,35907:4,33321:1,34842:8,34836:16,35056:4,33190:4,36012:4,33323:2,6408:4,6407:4,32849:4,35905:4};
 const face=t=>t>=34069&&t<=34074?34067:t;
 const key=(gl,t)=>{const u=unit.get(gl)??0;return u+':'+face(t);};
 const texOf=(gl,t)=>bound.get(gl)?.get(key(gl,t));
 const add=(gl,target,b,w,h)=>{const tex=texOf(gl,target);if(!tex)return;const r=bytesOf.get(tex)??{b:0,gl};r.b+=b;if(w)r.dim=w+'x'+h;bytesOf.set(tex,r);W.__texLive.set(tex,r);};
 /** One upload or allocation event on the texture bound to target: counts it, and records it in an open window. */
 const upload=(gl,target,bytes)=>{C.textureUploads++;const tex=texOf(gl,target);if(!tex)return;
  if(!texId.has(tex))texId.set(tex,nextTex++);const before=texUps.get(tex)??0;texUps.set(tex,before+1);
  const win=W.__win;if(!win)return;const id=texId.get(tex);let r=win.uploads.get(id);
  if(!r){r={resource:id,bytes:0,frame:win.frames,firstEver:before===0||win.newTex.has(id),count:0};win.uploads.set(id,r);}
  r.count++;r.bytes+=bytes;};
 for(const P of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
  for(const f of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const o=P[f];if(!o)continue;
   P[f]=function(...a){W.__draws++;if(fb.get(this)){W.__off++;if(!passOpen){W.__passes++;passOpen=true;}}const n=f.startsWith('drawElements')?a[1]:a[2];const inst=f.endsWith('Instanced')?a[f.startsWith('drawElements')?4:3]:1;W.__tris+=n/3*inst;return o.apply(this,a);};}
  const bf=P.bindFramebuffer;P.bindFramebuffer=function(t,f){fb.set(this,!!f);passOpen=false;return bf.call(this,t,f);};
  const vp=P.viewport;P.viewport=function(...a){passOpen=false;return vp.apply(this,a);};
  const at=P.activeTexture;P.activeTexture=function(u){unit.set(this,u);return at.call(this,u);};
  const bt=P.bindTexture;P.bindTexture=function(t,tex){let m=bound.get(this);if(!m){m=new Map();bound.set(this,m);ctxs.push(new WeakRef(this));}m.set((unit.get(this)??0)+':'+t,tex);return bt.call(this,t,tex);};
  const ti=P.texImage2D;P.texImage2D=function(...a){try{const lvl=a[1];let w,h,bpp;
    if(a.length>=8&&typeof a[3]==='number'){w=a[3];h=a[4];bpp=bppInt[a[2]]??((bppFmt[a[6]]??4)*(bppType[a[7]]??1));}
    else{const s=a[5];w=s?.videoWidth||s?.naturalWidth||s?.width||0;h=s?.videoHeight||s?.naturalHeight||s?.height||0;bpp=(bppFmt[a[3]]??4)*(bppType[a[4]]??1);}
    if(lvl===0){const tex=texOf(this,a[0]);if(tex&&face(a[0])===a[0]){const old=bytesOf.get(tex);bytesOf.set(tex,{b:0,base:w*h*bpp,gl:this,mips:old?.mips??0,ups:(old?.ups??0)+1});}}
    add(this,a[0],w*h*bpp,w,h);if(lvl===0)upload(this,a[0],w*h*bpp);}catch{}return ti.apply(this,a);};
  const tsi=P.texSubImage2D;P.texSubImage2D=function(...a){try{if(a[1]===0){const s=a[6];const w=typeof a[4]==='number'&&a.length>=9?a[4]:(s?.videoWidth||s?.naturalWidth||s?.width||0);const h=typeof a[5]==='number'&&a.length>=9?a[5]:(s?.videoHeight||s?.naturalHeight||s?.height||0);upload(this,a[0],w*h*4);}}catch{}return tsi.apply(this,a);};
  const ts=P.texStorage2D;if(ts)P.texStorage2D=function(t,levels,fmt,w,h){try{let b=0,x=w,y=h;for(let i=0;i<levels;i++){b+=x*y*(bppInt[fmt]??4);x=Math.max(1,x>>1);y=Math.max(1,y>>1);}add(this,t,t===34067?b*6:b,w,h);upload(this,t,0);}catch{}return ts.call(this,t,levels,fmt,w,h);};
  const ct=P.compressedTexImage2D;P.compressedTexImage2D=function(...a){try{add(this,a[0],a[6]?.byteLength??0);if(a[1]===0)upload(this,a[0],a[6]?.byteLength??0);}catch{}return ct.apply(this,a);};
  const gm=P.generateMipmap;P.generateMipmap=function(t){try{const tex=texOf(this,t);const r=tex&&bytesOf.get(tex);if(r){r.mips=(r.mips??0)+1;if(!r.mipped){r.mipped=true;r.b+=(r.base??r.b)/3;}}}catch{}return gm.call(this,t);};
  const ct2=P.createTexture;P.createTexture=function(){const tex=ct2.call(this);if(tex){texId.set(tex,nextTex++);W.__win?.newTex.add(texId.get(tex));}return tex;};
  const dt=P.deleteTexture;P.deleteTexture=function(tex){W.__texLive.delete(tex);return dt.call(this,tex);};
  const up=P.useProgram;P.useProgram=function(p){C.useProgram++;return up.call(this,p);};
  const lp=P.linkProgram;P.linkProgram=function(p){C.programsCreated++;return lp.call(this,p);};
  const bs=P.bufferSubData;P.bufferSubData=function(...a){C.bufferSubData++;return bs.apply(this,a);};
  if(P.bindVertexArray){const bv=P.bindVertexArray;P.bindVertexArray=function(v){C.bindVertexArray++;return bv.call(this,v);};}
  for(const f of Object.getOwnPropertyNames(P)){if(!/^uniform(Matrix)?[1-4]/.test(f))continue;const o=P[f];if(typeof o!=='function')continue;P[f]=function(...a){C.uniformCalls++;return o.apply(this,a);};}
 }
 const ce=Document.prototype.createElement;Document.prototype.createElement=function(n,...r){const e=ce.call(this,n,...r);if(String(n).toLowerCase()==='canvas')W.__canv.push(new WeakRef(e));return e;};
 if(W.OffscreenCanvas){const O=W.OffscreenCanvas;W.OffscreenCanvas=function(w,h){const c=new O(w,h);W.__canv.push(new WeakRef(c));return c;};W.OffscreenCanvas.prototype=O.prototype;}
 // Per-frame monitor. The largest off-screen burst since the last hash change is the shadow pass; the most off-screen
 // passes in one frame since then are the shadow-map renders.
 W.__offMax=0;W.__passMax=0;let lastOff=0,lastDraws=0,lastTris=0,lastT=0,lastPasses=0;
 const mon=t=>{const dOff=W.__off-lastOff,dDraws=W.__draws-lastDraws,dTris=W.__tris-lastTris,dPasses=W.__passes-lastPasses;lastOff=W.__off;lastDraws=W.__draws;lastTris=W.__tris;lastPasses=W.__passes;
  if(dOff>W.__offMax)W.__offMax=dOff;if(dPasses>W.__passMax)W.__passMax=dPasses;const win=W.__win;
  if(win&&!win.done){win.frames++;if(lastT)win.intervals.push(t-lastT);
   if(dDraws>0){win.rendered++;win.draws.push(dDraws);win.tris+=dTris;win.off+=dOff;if(dOff>0)win.offFrames++;}
   const el=t-win.t0;if(windowFinished(win,el)){win.done=true;win.complete=win.rendered>=win.target||win.frames>=2;win.resolve();}}
  lastT=t;requestAnimationFrame(mon);};requestAnimationFrame(mon);
 W.__topTex=(n=12)=>{const g=new Map();for(const [t,r] of W.__texLive){if(r.gl.isContextLost()||r.gl.canvas.isConnected===false)continue;const d=r.dim+(r.mips>5?' mip-regen x'+r.mips:'')+(r.ups>5?' re-uploads x'+r.ups:'');const e=g.get(d)??[0,0];e[0]++;e[1]+=r.b/1048576;g.set(d,e);}return [...g].sort((x,y)=>y[1][1]-x[1][1]).slice(0,n).map(([d,[c,m]])=>d+' x'+c+' = '+m.toFixed(1)+' MiB');};
 W.__gpu=()=>{let tex=0;for(const [t,r] of W.__texLive){if(r.gl.isContextLost())continue;const c=r.gl.canvas;if(c.isConnected===false)continue;tex+=r.b;}
  let canvas=0,n=0;W.__canv=W.__canv.filter(w=>{const c=w.deref();if(!c)return false;canvas+=c.width*c.height*4;n++;return true;});
  const alive=W.__ctxs.map(w=>w.deref()).filter(g=>g&&g.canvas.isConnected!==false);
  return {shadowPassDrawsMax:W.__offMax,shadowPassesMax:W.__passMax,textureMiB:+(tex/1048576).toFixed(1),canvasMiB:+(canvas/1048576).toFixed(1),canvases:n,
   liveContexts:alive.filter(g=>!g.isContextLost()).length,lostContexts:alive.filter(g=>g.isContextLost()).length};};
 /** Opens a window: guard the scene, zero the counters. Idle windows end after target rendered frames (at least
  *  minMs) or at maxMs; target 0 ends at maxMs (active windows, timed by their script). */
 W.__winOpen=(sel,target,minMs,maxMs,scriptPending=false)=>{const e=document.querySelector(sel);const token=Symbol('bench-epoch');if(e)e.__benchEpoch=token;
  let resolve;const done=new Promise(r=>{resolve=r;});
  W.__win={sel,token,el:e?new WeakRef(e):null,hash:location.hash,changes:W.__hashChanges,t0:performance.now(),target,minMs,maxMs,scriptPending,frames:0,rendered:0,draws:[],tris:0,off:0,offFrames:0,
   intervals:[],uploads:new Map(),newTex:new Set(),counts:{...C},lost:W.__gpu().lostContexts,done:false,complete:false,resolve,finished:done};
  return !!e;};
 W.__winClose=()=>{const w=W.__win;if(!w)return null;w.done=true;w.resolve();W.__win=null;
  const e=w.el?.deref();const now=document.querySelector(w.sel);let epochBreak=null;
  if(location.hash!==w.hash)epochBreak='hash '+w.hash+' -> '+location.hash;
  else if(W.__hashChanges!==w.changes)epochBreak='hash changed '+(W.__hashChanges-w.changes)+' time(s) during the window';
  else if(!e||!e.isConnected||now!==e||e.__benchEpoch!==w.token)epochBreak='scene element replaced (re-entry or exit)';
  const counts={};for(const k in C)counts[k]=C[k]-w.counts[k];
  const iv=[...w.intervals].sort((a,b)=>a-b);const q=p=>iv.length?iv[Math.min(iv.length-1,Math.floor(p*iv.length))]:null;
  return {hash:location.hash,epochBreak,scriptComplete:!w.scriptPending,lostContexts:W.__gpu().lostContexts-w.lost,ms:performance.now()-w.t0,frames:w.frames,rendered:w.rendered,complete:w.complete||(w.target===0&&w.frames>=2),
   draws:w.draws.reduce((a,b)=>a+b,0),drawsMax:w.draws.length?Math.max(...w.draws):0,tris:w.tris,off:w.off,offFrames:w.offFrames,
   frameMsP95:q(.95),frameMsMax:iv.length?iv[iv.length-1]:null,counts,uploads:[...w.uploads.values()]};};
})()`;
