import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,renameSync,rmSync,openSync,closeSync,existsSync,readdirSync} from 'node:fs';
import {join,posix} from 'node:path';
const digest=data=>createHash('sha256').update(data).digest('hex');
const safePath=p=>typeof p==='string'&&p.length>0&&p.length<=240&&!p.includes('\\')&&!p.includes('\0')&&!p.endsWith('/')&&!p.startsWith('/')&&posix.normalize(p)===p&&!p.split('/').some(x=>x==='..'||x==='.')&&p!=='manifest.json';
/** Immutable artifacts, then one atomic pointer promotion. No multi-file partial bundle is published. */
export function publishContent(root,description,{readSource,write=writeFileSync}={}){
 if(!Number.isSafeInteger(description.schemaVersion)||description.schemaVersion<1||typeof description.contentVersion!=='string'||!description.contentVersion||!Array.isArray(description.artifacts)||!description.artifacts.length||description.artifacts.length>1024||typeof readSource!=='function')throw Error('content: invalid description');
 // Snapshot the entire manifest before invoking caller-owned source readers.
 const schemaVersion=description.schemaVersion,contentVersion=description.contentVersion;
 if(contentVersion.length>256)throw Error('content version too long');
 const rows=description.artifacts.map(a=>({path:a.path,source:a.source,references:a.references===undefined?[]:Array.isArray(a.references)?[...a.references]:null}));
 const paths=new Set(),artifacts=[];let bytes=0;
 for(const a of rows){
  if(!safePath(a.path)||paths.has(a.path))throw Error('invalid artifact path');paths.add(a.path);
 }
 let referenceCount=0;
 for(const a of rows){
  if(!a.references||a.references.length>1024||a.references.some(p=>!paths.has(p)))throw Error('invalid artifact references');
  referenceCount+=a.references.length;if(referenceCount>8192)throw Error('too many artifact references');
  if(a.path.split('/').slice(0,-1).some((_,i)=>paths.has(a.path.split('/').slice(0,i+1).join('/'))))throw Error('artifact path conflicts with directory');
 }
 for(const a of rows){
  const data=Buffer.from(readSource(a.source));bytes+=data.length;if(bytes>16*1024*1024)throw Error('content bundle exceeds byte limit');
  artifacts.push({path:a.path,data,hash:digest(data),references:a.references});
 }
 // Release identity uses UTF-16 code-unit order, independent of host locale/ICU.
 artifacts.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const manifest={schemaVersion,contentVersion,artifacts:artifacts.map(a=>({path:a.path,bytes:a.data.length,sha256:a.hash,references:a.references}))};
 const manifestBytes=JSON.stringify(manifest,null,2)+'\n',id=digest(manifestBytes);
 mkdirSync(root,{recursive:true});const lock=join(root,'.publish.lock');let fd;
 try{fd=openSync(lock,'wx');}catch{throw Error('content: publisher already active or stale lock requires inspection');}
 const staging=join(root,'.stage-'+randomUUID()),pointer=join(root,'.active-'+randomUUID()),release=join(root,'releases',id);
 try{
  const releases=join(root,'releases');mkdirSync(releases,{recursive:true});
  if(!existsSync(release)){
   if(readdirSync(releases).length>=32)throw Error('content: release retention full; archive explicitly before publishing');
   mkdirSync(staging);
   for(const a of artifacts){const file=join(staging,a.path);mkdirSync(join(file,'..'),{recursive:true});write(file,a.data);}
   write(join(staging,'manifest.json'),manifestBytes);
   // Verify actual writes, including adapters which returned without throwing after a partial write.
   for(const a of artifacts)if(digest(readFileSync(join(staging,a.path)))!==a.hash)throw Error('content: staged artifact verification failed');
   if(readFileSync(join(staging,'manifest.json'),'utf8')!==manifestBytes)throw Error('content: staged manifest verification failed');
   renameSync(staging,release);
  }
  // Existing immutable output must also verify; same version cannot bless corrupted storage.
  if(readFileSync(join(release,'manifest.json'),'utf8')!==manifestBytes)throw Error('content: existing manifest mismatch');
  for(const a of artifacts)if(digest(readFileSync(join(release,a.path)))!==a.hash)throw Error('content: existing artifact mismatch');
  const active=existsSync(join(root,'active.json'))?JSON.parse(readFileSync(join(root,'active.json'),'utf8')):null;
  writeFileSync(pointer,JSON.stringify({id,previous:active?.id===id?active.previous:active?.id??null})+'\n');renameSync(pointer,join(root,'active.json'));
  return {id,artifacts:artifacts.length,bytes};
 }finally{rmSync(staging,{recursive:true,force:true});rmSync(pointer,{force:true});closeSync(fd);rmSync(lock,{force:true});}
}
