// Builds the app into a throwaway folder and serves it with `vite preview` on a free local port, for the bench.
// Returns the digest of every emitted file (ADR 0046 decision 1: the conservative whole-executable-build key) and
// the chunk sizes. Nothing is written into the repo's dist/.
import {build,preview} from 'vite';
import {createHash} from 'node:crypto';
import {mkdtempSync,readdirSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=fileURLToPath(new URL('../..',import.meta.url));

function files(dir){const out=[];for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...files(p));else out.push(p);}return out;}

/** sha256 over every emitted file's relative path and bytes, sorted: any executable, asset or HTML change moves it. */
export function digestDir(dir){
 const h=createHash('sha256');const list=files(dir).map(p=>[relative(dir,p).split(sep).join('/'),p]).sort(([a],[b])=>a<b?-1:a>b?1:0);
 for(const [rel,p] of list){h.update(rel);h.update('\0');h.update(readFileSync(p));h.update('\0');}
 return {digest:h.digest('hex'),files:list.length};
}

/** Emitted JS chunk sizes in KiB by chunk name (the part of the file name before the content hash). */
export function chunkSizes(dir){
 const out={};const assets=join(dir,'assets');
 for(const f of readdirSync(assets)){if(!f.endsWith('.js'))continue;const name=f.replace(/-[\w-]{8}\.js$/,'');out[name]=+((out[name]??0)+statSync(join(assets,f)).size/1024).toFixed(1);}
 return out;
}

/** Builds (quietly) and serves. `close()` stops the server and deletes the folder. */
export async function buildAndServe({outDir,mode='production'}={}){
 const dir=outDir??mkdtempSync(join(tmpdir(),'engine-perf-build-'));
 await build({root:ROOT,mode,logLevel:'error',build:{outDir:dir,emptyOutDir:true,manifest:true}});
 const server=await preview({root:ROOT,mode,logLevel:'error',build:{outDir:dir},preview:{host:'127.0.0.1',port:0,strictPort:false,open:false}});
 const url=(server.resolvedUrls?.local?.[0]??'').replace(/\/$/,'');
 if(!url)throw Error('vite preview did not report a URL');
 const {digest,files:count}=digestDir(dir);
 return {url,outDir:dir,digest,fileCount:count,chunks:chunkSizes(dir),
  async close(){await new Promise(r=>server.httpServer.close(()=>r()));if(!outDir)rmSync(dir,{recursive:true,force:true});}};
}
