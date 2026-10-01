import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MemoryBackend} from './storage-port';
import {createSaveStore} from './store';
import {createTestReset} from './test-reset';
import type {SaveSection} from './section';
const section:SaveSection<number>={id:'score',scope:'player',version:1,initial:()=>0,parse:v=>{if(typeof v!=='number')throw Error('number required');return v;}};
test('reset clears the retired store and seeds fresh section values that survive another boot',()=>{
 const disk=new MemoryBackend(),session=new MemoryBackend();
 const fresh=()=>createSaveStore({local:disk.port(),session:session.port(0,'session'),build:'test',sections:[section]});
 const old=fresh();old.section(section).of('1').replace(9,{now:true});
 disk.port().set('unrelated','keep');let retired=false;
 createTestReset(old,fresh,[section],()=>{retired=true;})([{section:'score',player:'1',value:4}]);
 assert.ok(retired);assert.equal(fresh().section(section).of('1').get(),4);
 assert.equal(disk.port().get('unrelated'),'keep');
 old.flush();assert.equal(fresh().section(section).of('1').get(),4);
});
test('reset fails loudly on an invalid seed',()=>{
 const disk=new MemoryBackend();const fresh=()=>createSaveStore({local:disk.port(),session:new MemoryBackend().port(0,'session'),build:'test',sections:[section]});
 assert.throws(()=>createTestReset(fresh(),fresh,[section],()=>{})([{section:'unknown',value:4}]),/no section/);
});
