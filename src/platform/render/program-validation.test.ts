import test from 'node:test';
import assert from 'node:assert/strict';
import {installProgramValidation,ProgramLinkError} from './program-validation';
function fixture(){
 let valid=true,lost=false,queries=0,logs=0,uses=0,links=0;
 const gl={LINK_STATUS:35714,createProgram:()=>({}),isContextLost:()=>lost,linkProgram(){links++;},deleteProgram(){},useProgram(){uses++;},getProgramParameter(){queries++;return valid;},getProgramInfoLog(){logs++;return 'bad'.repeat(2000);},getAttachedShaders(){return [{},{}];},getShaderInfoLog(){logs++;return 'shader failure';}} as unknown as WebGL2RenderingContext;
 const api=installProgramValidation(gl),p={} as WebGLProgram;
 return {gl,api,p,setValid(v:boolean){valid=v;},setLost(v:boolean){lost=v;},get counts(){return {queries,logs,uses,links};}};
}
test('success is checked once per link, without success log reads or wrapper stacking',()=>{
 const f=fixture();assert.equal(installProgramValidation(f.gl),f.api);
 f.gl.linkProgram(f.p);f.gl.useProgram(f.p);f.gl.useProgram(f.p);f.api.validate(f.p);
 assert.deepEqual(f.counts,{queries:1,logs:0,uses:2,links:1});
 f.gl.linkProgram(f.p);f.gl.useProgram(f.p);assert.equal(f.counts.queries,2);
 f.gl.useProgram(null);assert.equal(f.counts.queries,2);
});
test('failed relink and future program refuse use, retain bounded diagnostics and cache failure',()=>{
 const f=fixture();f.gl.linkProgram(f.p);f.gl.useProgram(f.p);f.setValid(false);f.gl.linkProgram(f.p);
 let error:ProgramLinkError|undefined;
 assert.throws(()=>f.gl.useProgram(f.p),e=>{error=e as ProgramLinkError;return e instanceof ProgramLinkError;});
 assert.equal(error!.programLog.length,4096);assert.equal(error!.shaderLogs.length,2);
 assert.throws(()=>f.gl.useProgram(f.p),e=>e===error);assert.deepEqual(f.counts,{queries:2,logs:3,uses:1,links:2});
 const later={} as WebGLProgram;f.gl.linkProgram(later);assert.throws(()=>f.gl.useProgram(later),ProgramLinkError);
});
test('deleted and restored old handles are rejected without native queries; fresh links work',()=>{
 const f=fixture();f.gl.linkProgram(f.p);f.gl.useProgram(f.p);f.gl.deleteProgram(f.p);
 assert.throws(()=>f.gl.useProgram(f.p),/deleted/);assert.equal(f.counts.queries,1);
 const old={} as WebGLProgram;f.gl.linkProgram(old);f.setLost(true);f.api.clear();f.api.validate(old);assert.equal(f.counts.queries,1);
 f.setLost(false);assert.throws(()=>f.gl.linkProgram(old),/retired/);assert.throws(()=>f.gl.useProgram(old),/retired/);assert.equal(f.counts.queries,1);
 const fresh={} as WebGLProgram;f.gl.linkProgram(fresh);f.gl.useProgram(fresh);assert.equal(f.counts.queries,2);
});
