import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {bakeGeometry} from './geometry';
test('paint bake retains exact authored attributes and releases temporary inputs once',()=>{
 const parts=[new T.BoxGeometry(),new T.BoxGeometry().translate(3,0,0)];let disposed=0;
 parts.forEach(p=>p.addEventListener('dispose',()=>disposed++));
 const expected=parts.flatMap(p=>Array.from(p.getAttribute('position').array));
 const merged=bakeGeometry(parts);assert.equal(disposed,2);assert.deepEqual(Array.from(merged.getAttribute('position').array),expected);assert.equal(merged.index!.count,72);
});

test('nullable material buckets preserve failure fallback and retire each temporary once',async t=>{
 const {tryBakeGeometry}=await import('./geometry');
 const a=new T.BoxGeometry(),b=new T.BoxGeometry();b.deleteAttribute('normal');let released=0;
 for(const g of [a,b])g.addEventListener('dispose',()=>released++);
 t.mock.method(console,'error',()=>{});
 assert.equal(tryBakeGeometry([a,b]),null);assert.equal(released,2);
 const c=new T.BoxGeometry();let once=0;c.addEventListener('dispose',()=>once++);
 const merged=tryBakeGeometry([c,c])!;assert.equal(once,1);assert.equal(merged.index!.count,72);merged.dispose();
});
