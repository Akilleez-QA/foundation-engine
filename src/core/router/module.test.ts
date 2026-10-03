import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app';
import {defineModule} from '../module';
import {routerModule} from './module';
import type {RouterWindow} from './router';

function fakeWindow(hash: string): RouterWindow {
  return {
    location: {hash},
    history: {
      replaceState(_d, _u, url) {
        this_.location.hash = String(url);
      },
    },
    addEventListener() {},
  } as RouterWindow;
}
let this_: RouterWindow;

const scenes = defineModule({
  id: 'feature.scenes',
  version: '1.0.0',
  requires: ['core.router'],
  register(r) {
    r.scenes.add(
      {
        id: 'scene.home',
        kind: 'outdoor',
        routes: [{hash: '#home'}],
        title: 'Home',
        icon: 'home',
        color: '#445566',
      } as never,
      'feature.scenes',
    );
    r.scenes.add(
      {
        id: 'scene.shed',
        kind: 'scene',
        routes: [{hash: '#shed'}],
        title: 'Shed',
        icon: 'door',
        color: '#665544',
        parent: 'scene.home',
      } as never,
      'feature.scenes',
    );
    r.redirects.add(
      {id: 'redirect.old-shed', from: '#barn', to: '#shed', note: 'renamed in 1.1'} as never,
      'feature.scenes',
    );
  },
});

test('core.router: scenes and redirects are rows; the router resolves against the frozen tables', async () => {
  this_ = fakeWindow('#barn');
  const app = createApp([routerModule({win: () => this_}), scenes], {mode: 'test', log() {}});
  const report = await app.boot();
  assert.ok(
    report.modules.every(m => m.status === 'installed'),
    JSON.stringify(report.modules),
  );
  assert.equal(app.services.router.resolve().sceneId, 'scene.shed');
  assert.equal(app.probes.read('router')?.routes, 2);
  app.dispose();
});

test('core.router: two scenes claiming one route fail validation', async () => {
  this_ = fakeWindow('#home');
  const dup = defineModule({
    id: 'feature.dup',
    version: '1.0.0',
    requires: ['core.router'],
    register(r) {
      r.scenes.add(
        {
          id: 'scene.copy',
          kind: 'scene',
          routes: [{hash: '#home'}],
          title: 'Copy',
          icon: 'x',
          color: '#000000',
        } as never,
        'feature.dup',
      );
    },
  });
  const app = createApp([routerModule({win: () => this_}), scenes, dup], {mode: 'test', log() {}});
  const report = await app.boot().catch(e => e);
  const failed =
    report instanceof Error ? true : report.modules.some((m: {status: string}) => m.status !== 'installed');
  assert.ok(failed, 'a duplicate route is a problem');
});
