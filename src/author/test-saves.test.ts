// createTestSaves: saves that outlive one testScene, so a game test can save, "reload" and read the value back.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestSaves, defineSaveSection, defineScene, defineSystem, testScene} from './index';

const best = defineSaveSection({id: 'run.best', initial: {score: 0}});
const finish = defineSystem({
  id: 'finish',
  run(ctx) {
    if (ctx.state.done) return;
    ctx.state.done = true;
    ctx.save(best).update(d => {
      d.score = Math.max(d.score, ctx.state.score as number);
    });
  },
});
const level = defineScene({
  id: 'level',
  title: 'Level',
  systems: [finish],
  enter(ctx) {
    ctx.state.best = ctx.save(best).get().score;
    ctx.state.score = Number(ctx.scene.params.score ?? 0);
  },
});

test('a value saved in one testScene is read after a reload', async () => {
  const saves = createTestSaves();
  const first = await testScene(level, {params: {score: '12'}, services: {save: saves.store}});
  assert.equal(first.ctx.state.best, 0);
  first.run(1 / 60);
  first.dispose();
  const second = await testScene(level, {services: {save: saves.reload()}});
  assert.equal(second.ctx.state.best, 12, 'the reloaded scene reads the saved best');
  second.dispose();
  saves.dispose();
});

test('without a shared store, each testScene starts empty', async () => {
  const first = await testScene(level, {params: {score: '12'}});
  first.run(1 / 60);
  first.dispose();
  const second = await testScene(level);
  assert.equal(second.ctx.state.best, 0);
  second.dispose();
});

test('a reload that never flushed loses pending writes, keeps flushed ones', async () => {
  const saves = createTestSaves();
  const first = await testScene(level, {params: {score: '5'}, services: {save: saves.store}});
  first.run(1 / 60);
  saves.store.flush(); // 5 is on "disk"
  first.ctx.save(best).update(d => {
    d.score = 9;
  }); // 9 is pending only
  first.dispose(); // exit only: the injected store stays open
  const crashed = await testScene(level, {services: {save: saves.reload({flush: false})}});
  assert.equal(crashed.ctx.state.best, 5, 'the pending 9 was lost, the flushed 5 kept');
  crashed.dispose();
  saves.dispose();
});

test('createTestSaves owns its stores: reload disposes the old one; dispose ends it', async () => {
  const saves = createTestSaves();
  const old = saves.store;
  const handle = old.section(best.section);
  const fresh = saves.reload();
  assert.notEqual(fresh, old);
  assert.equal(saves.store, fresh);
  assert.throws(() => handle.get(), /disposed/, 'handles of the old store throw, as after a page reload');
  assert.throws(() => saves.reload({flush: 'no' as never}), /reload options/);
  saves.dispose();
  saves.dispose();
  assert.throws(() => saves.store, /createTestSaves: disposed/);
  assert.throws(() => saves.reload(), /createTestSaves: disposed/);
});
