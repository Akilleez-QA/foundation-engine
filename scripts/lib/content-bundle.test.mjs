import {spawnSync} from 'node:child_process';
import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {publishContent} from './content-bundle.mjs';
const spec=v=>({schemaVersion:1,contentVersion:v,artifacts:[{path:'a.json',source:'a',references:['b.json']},{path:'b.json',source:'b'}]});
const setup=t=>{const root=mkdtempSync(join(tmpdir(),'foundation-content-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
test('failed second artifact write keeps last playable pointer and all previous bytes',t=>{const root=setup(t),first=publishContent(root,spec('1'),{readSource:p=>p});const pointer=readFileSync(join(root,'active.json'),'utf8');let writes=0;assert.throws(()=>publishContent(root,spec('2'),{readSource:p=>p+'2',write:(p,data)=>{if(++writes===2)throw Error('disk');writeFileSync(p,data);}}));assert.equal(readFileSync(join(root,'active.json'),'utf8'),pointer);assert.equal(readFileSync(join(root,'releases',first.id,'a.json'),'utf8'),'a');assert.equal(existsSync(join(root,'.publish.lock')),false);});
test('missing dependencies and traversal fail before publication; corrupt writes never promote',t=>{const root=setup(t);assert.throws(()=>publishContent(root,{...spec('1'),artifacts:[{path:'../bad',source:'a'}]},{readSource:p=>p}));assert.throws(()=>publishContent(root,{...spec('1'),artifacts:[{path:'a',source:'a',references:['missing']}]},{readSource:p=>p}));assert.throws(()=>publishContent(root,spec('1'),{readSource:p=>p,write:(p)=>writeFileSync(p,'corrupt')}));assert.equal(existsSync(join(root,'active.json')),false);});
test('stable content IDs survive source ordering and preserve previous release for recovery',t=>{const root=setup(t),a=publishContent(root,spec('1'),{readSource:p=>p}),b=publishContent(root,spec('2'),{readSource:p=>p+'2'});assert.deepEqual(JSON.parse(readFileSync(join(root,'active.json'),'utf8')),{id:b.id,previous:a.id});assert.equal(publishContent(root,{...spec('2'),artifacts:spec('2').artifacts.reverse()},{readSource:p=>p+'2'}).id,b.id);});

test('source callbacks cannot replace validated paths or manifest fields',t=>{
 const root=setup(t),description=spec('1');let called=false;
 const result=publishContent(root,description,{readSource:p=>{if(!called){called=true;description.artifacts[0].path='../escape';description.artifacts[0].references.push('missing');description.schemaVersion=-1;description.contentVersion='mutated';}return p;}});
 const manifest=JSON.parse(readFileSync(join(root,'releases',result.id,'manifest.json'),'utf8'));
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.contentVersion,'1');assert.deepEqual(manifest.artifacts[0].references,['b.json']);assert.equal(existsSync(join(root,'escape')),false);
});
test('unbounded references and file/directory collisions fail before source access',t=>{
 const root=setup(t);let reads=0;
 for(const artifacts of [[{path:'a',source:'a',references:Array(1025).fill('a')}],[{path:'a',source:'a'},{path:'a/b',source:'b'}]])assert.throws(()=>publishContent(root,{schemaVersion:1,contentVersion:'1',artifacts},{readSource:()=>{reads++;return '';}}));
 assert.equal(reads,0);
});


test('release identity is locale independent and keeps authored reference order', t => {
  const root = setup(t);
  const moduleUrl = new URL('./content-bundle.mjs', import.meta.url).href;
  const rows = ['ä.json', 'z.json', 'A.json', 'a.json'].map(path => ({
    path, source: path, references: ['z.json', 'A.json', 'z.json'],
  }));
  const outputs = ['en_US.UTF-8', 'sv_SE.UTF-8'].map((locale, index) => {
    const directory = join(root, String(index));
    const description = {schemaVersion: 1, contentVersion: 'locale-proof',
      artifacts: index ? [...rows].reverse() : rows};
    const script = `
      import {readFileSync} from 'node:fs';
      import {join} from 'node:path';
      import {publishContent} from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(directory)};
      const result = publishContent(root, ${JSON.stringify(description)}, {readSource: p => p});
      console.log(JSON.stringify({id: result.id,
        manifest: readFileSync(join(root, 'releases', result.id, 'manifest.json'), 'utf8'),
        collation: ['z', 'ä'].sort((a, b) => a.localeCompare(b))}));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', env: {...process.env, LANG: locale, LC_ALL: locale},
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr || String(child.error));
    return JSON.parse(child.stdout);
  });
  // Prove the fixture actually exercises distinct default collation environments.
  assert.notDeepEqual(outputs[0].collation, outputs[1].collation);
  assert.equal(outputs[0].id, outputs[1].id);
  assert.equal(outputs[0].manifest, outputs[1].manifest);
  const artifacts = JSON.parse(outputs[0].manifest).artifacts;
  assert.deepEqual(artifacts.map(a => a.path), ['A.json', 'a.json', 'z.json', 'ä.json']);
  for (const artifact of artifacts) assert.deepEqual(artifact.references, ['z.json', 'A.json', 'z.json']);
});
