import {test} from 'node:test';import assert from 'node:assert/strict';import {createEquipment,type EquipmentSnapshot} from './index';
test('equipment does not turn a malformed truthy cosmetic flag into functional gear',()=>{
 const snapshot={revision:0,items:[{id:'hat',definition:'hat',slots:['head'],functional:'false'}],equipped:['hat']} as unknown as EquipmentSnapshot;
 assert.throws(()=>createEquipment(['head'],1,snapshot));
});
