import test from 'node:test';
import assert from 'node:assert/strict';
import {createDependencyBudget} from './dependency-budget';

test('shared admission conserves safe integer bytes and idempotent owner releases',()=>{
 const budget=createDependencyBudget(Number.MAX_SAFE_INTEGER);
 const first=budget.reserve(Number.MAX_SAFE_INTEGER-1),last=budget.reserve(1);
 assert.deepEqual(budget.stats,{maxBytes:Number.MAX_SAFE_INTEGER,reservedBytes:Number.MAX_SAFE_INTEGER,owners:2});
 assert.throws(()=>budget.reserve(1),/admission exceeded/);
 first.release();first.release();
 assert.equal(budget.stats.reservedBytes,1);assert.equal(budget.stats.owners,1);
 last.release();assert.equal(budget.stats.reservedBytes,0);assert.equal(budget.stats.owners,0);
});
test('invalid budgets and reservations do not alter admission',()=>{
 for(const value of [-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>createDependencyBudget(value),/invalid limit/);
 const budget=createDependencyBudget(0);
 for(const value of [-1,NaN,Infinity,0.5])assert.throws(()=>budget.reserve(value),/invalid reservation/);
 const empty=budget.reserve(0);assert.equal(budget.stats.owners,1);empty.release();
 assert.deepEqual(budget.stats,{maxBytes:0,reservedBytes:0,owners:0});
});
