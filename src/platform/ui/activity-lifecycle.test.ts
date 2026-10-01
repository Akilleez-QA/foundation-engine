import {test} from 'node:test';import assert from 'node:assert/strict';import {activityEntered,activityLeaving,onActivityLeave} from './activity-lifecycle';
class Screen extends EventTarget{open=false;enter(){this.open=true;activityEntered(this);}leave(){activityLeaving(this);this.open=false;}closeEvent(){this.dispatchEvent(new Event('close'));}}
test('rapid re-entry retires only the old resource generation, exactly once',()=>{
 const d=new Screen();let current=0;const disposed:number[]=[];onActivityLeave(d,()=>disposed.push(current));
 d.enter();current=1;d.leave();assert.deepEqual(disposed,[1]);d.enter();current=2;d.closeEvent();assert.deepEqual(disposed,[1]);d.leave();d.closeEvent();assert.deepEqual(disposed,[1,2]);
});
test('native close fallback and partial initialization are cleaned once',()=>{
 const d=new Screen();let count=0;const remove=onActivityLeave(d,()=>count++);d.enter();d.open=false;d.closeEvent();d.closeEvent();assert.equal(count,1);d.enter();remove();d.closeEvent();assert.equal(count,2);
});
test('cleanup attached after opening still retires the active editor exactly once',()=>{
 const d=new Screen();d.enter();let count=0;onActivityLeave(d,()=>count++);d.leave();d.closeEvent();assert.equal(count,1);
});
test('a removed hook hears nothing more',()=>{
 const d=new Screen();d.enter();let count=0;const remove=onActivityLeave(d,()=>count++);remove();d.enter();d.leave();assert.equal(count,1,'a removed hook hears nothing more');
});
