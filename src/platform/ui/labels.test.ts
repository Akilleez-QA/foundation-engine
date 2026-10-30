import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clampLabelToView as scene, createLabelLayer, type SizeEntry} from './labels';
import {must} from '../../testing/must';

/** A label stand-in that logs every layout read and every write, in order. */
function fakeLabel(log: string[], name: string, size = {width: 80, height: 30}) {
  const style: Record<string, string> = {},
    dataset: Record<string, string | undefined> = {};
  let hidden = false,
    text = name;
  const el = {
    size,
    get hidden() {
      return hidden;
    },
    set hidden(v: boolean) {
      log.push(`write ${name} hidden=${v}`);
      hidden = v;
    },
    get textContent() {
      return text;
    },
    set textContent(v: string) {
      log.push(`write ${name} text`);
      text = v;
    },
    style: {
      setProperty(k: string, v: string) {
        log.push(`write ${name} ${k}=${v}`);
        style[k] = v;
      },
    },
    dataset: new Proxy(dataset, {
      set(t, k: string, v) {
        log.push(`write ${name} data-${k}=${v}`);
        t[k] = v;
        return true;
      },
      deleteProperty(t, k: string) {
        log.push(`write ${name} -data-${k}`);
        delete t[k];
        return true;
      },
    }),
    getBoundingClientRect() {
      log.push(`read ${name}`);
      return hidden ? {width: 0, height: 0} : {...el.size};
    },
    styles: style,
  };
  return el;
}
type Fake = ReturnType<typeof fakeLabel>;
const html = (f: Fake) => f as unknown as HTMLElement;

function fakeObserver() {
  let push: ((e: readonly SizeEntry[]) => void) | null = null;
  const observed = new Set<Element>();
  return {
    observed,
    report(entries: SizeEntry[]) {
      push?.(entries);
    },
    factory(onSizes: (e: readonly SizeEntry[]) => void) {
      push = onSizes;
      return {
        observe: (el: Element) => observed.add(el),
        unobserve: (el: Element) => observed.delete(el),
        disconnect: () => observed.clear(),
      };
    },
  };
}

const camera = () => {
  const c = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  c.position.set(0, 0, 10);
  c.updateMatrixWorld();
  return c;
};

test('a frame reads every size before it writes anything, and never reads after a write', () => {
  const log: string[] = [],
    ro = fakeObserver(),
    layer = createLabelLayer<number>({observer: ro.factory});
  const labels = [0, 1, 2].map(i => fakeLabel(log, `l${i}`));
  labels.forEach((l, i) =>
    layer.add({
      element: html(l),
      key: i,
      anchor: out => {
        out.set(i * 2, 0, 0);
        return true;
      },
    }),
  );
  const arrange = (all: readonly import('./labels').ScenedLabel<number>[], v: {width: number; height: number}) => {
    for (const p of all) {
      const s = p.size();
      p.style.left = `${((p.ndc.x + 1) * v.width) / 2 - s.width / 2}px`;
      p.hidden = false;
    }
  };
  layer.scene(camera(), {width: 400, height: 300}, arrange);
  const firstWrite = log.findIndex(l => l.startsWith('write')),
    lastRead = log.map(l => l.startsWith('read')).lastIndexOf(true);
  assert.ok(lastRead < firstWrite, log.join('\n'));
  assert.equal(must(labels[1]).styles.left, `${(0.2 + 1) * 200 - 40}px`);
  // Second frame: sizes are cached, so no reads at all; unchanged values are not written again.
  log.length = 0;
  layer.scene(camera(), {width: 400, height: 300}, arrange);
  assert.deepEqual(log, []);
});

test('the observer feeds the cache, ignores hidden 0 × 0 reports and re-places a shown label that changed size', () => {
  const log: string[] = [],
    ro = fakeObserver(),
    layer = createLabelLayer({observer: ro.factory});
  const a = fakeLabel(log, 'a');
  layer.add({
    element: html(a),
    anchor: out => {
      out.set(0, 0, 0);
      return true;
    },
  });
  assert.ok(ro.observed.has(html(a)));
  let runs = 0;
  const arrange = (all: readonly import('./labels').ScenedLabel[]) => {
    runs++;
    must(all[0]).style.width = `${must(all[0]).size().width}px`;
  };
  ro.report([{target: html(a), width: 50, height: 20}]);
  layer.scene(camera(), {width: 400, height: 300}, arrange);
  assert.equal(a.styles.width, '50px');
  assert.ok(!log.some(l => l.startsWith('read')), 'an observed size needs no read');
  ro.report([{target: html(a), width: 0, height: 0}]);
  assert.equal(runs, 1, 'a hidden report neither changes the size nor re-scenes');
  ro.report([{target: html(a), width: 64, height: 20}]);
  assert.equal(runs, 2);
  assert.equal(a.styles.width, '64px');
});

test('a new viewport width or new text forgets the cached size', () => {
  const log: string[] = [],
    layer = createLabelLayer({observer: () => null});
  const a = fakeLabel(log, 'a'),
    handle = layer.add({element: html(a)});
  const arrange = (all: readonly import('./labels').ScenedLabel[]) => {
    must(all[0]).style.width = `${must(all[0]).size().width}px`;
  };
  layer.scene(camera(), {width: 400, height: 300}, arrange);
  a.size = {width: 120, height: 30};
  log.length = 0;
  layer.scene(camera(), {width: 400, height: 300}, arrange);
  assert.equal(a.styles.width, '80px', 'cached');
  layer.scene(camera(), {width: 390, height: 300}, arrange);
  assert.equal(a.styles.width, '120px', 'remeasured at the new width');
  a.size = {width: 150, height: 30};
  handle.setText('longer');
  layer.scene(camera(), {width: 390, height: 300}, arrange);
  assert.equal(a.styles.width, '150px', 'remeasured after setText');
});

test('an unknown size is measured in the state asked for, then restored; a hidden label is shown only for the read', () => {
  const log: string[] = [];
  const layer = createLabelLayer({
    observer: () => null,
    stateOf: el => (el.dataset.pin !== undefined ? 'pin' : ''),
    measureAs: (el, state) => {
      const had = el.dataset.pin;
      if (state === 'pin') el.dataset.pin = '↑';
      const shown = el.hidden;
      el.hidden = false;
      return () => {
        el.hidden = shown;
        if (had === undefined) delete el.dataset.pin;
      };
    },
  });
  const a = fakeLabel(log, 'a');
  a.hidden = true;
  log.length = 0;
  layer.add({element: html(a)});
  let size = {width: 0, height: 0};
  layer.scene(camera(), {width: 400, height: 300}, all => {
    size = must(all[0]).size('pin');
    must(all[0]).hidden = true;
  });
  assert.deepEqual(size, {width: 80, height: 30});
  assert.equal(a.hidden, true);
  assert.equal(a.dataset.pin, undefined);
});

test('removing a label stops placing and observing it; dispose disconnects', () => {
  const ro = fakeObserver(),
    layer = createLabelLayer({observer: ro.factory}),
    log: string[] = [];
  const a = fakeLabel(log, 'a'),
    b = fakeLabel(log, 'b');
  const ha = layer.add({element: html(a)});
  layer.add({element: html(b)});
  ha.remove();
  let seen = 0;
  layer.scene(camera(), {width: 10, height: 10}, all => {
    seen = all.length;
  });
  assert.equal(seen, 1);
  assert.ok(!ro.observed.has(html(a)));
  assert.equal(layer.last(html(b))?.element, html(b));
  layer.dispose();
  assert.equal(ro.observed.size, 0);
});

test('an anchor that returns false leaves the label unprojected; decisions reset every frame', () => {
  const layer = createLabelLayer({observer: () => null}),
    log: string[] = [],
    a = fakeLabel(log, 'a');
  let on = true;
  layer.add({
    element: html(a),
    anchor: out => {
      out.set(0, 0, 0);
      return on;
    },
  });
  const flags: boolean[] = [];
  layer.scene(camera(), {width: 10, height: 10}, all => {
    flags.push(must(all[0]).projected);
    must(all[0]).data.pin = '→';
  });
  on = false;
  layer.scene(camera(), {width: 10, height: 10}, all => {
    flags.push(must(all[0]).projected);
    assert.equal(must(all[0]).data.pin, undefined);
    must(all[0]).data.pin = null;
  });
  assert.deepEqual(flags, [true, false]);
  assert.equal(a.dataset.pin, undefined);
});

// Map labels (formerly map-label-placement.test.ts).
test('map labels reject offscreen anchors in every axis and invalid projection', () => {
  for (const point of [
    {x: 1.01, y: 0, z: 0},
    {x: -1.01, y: 0, z: 0},
    {x: 0, y: 1.01, z: 0},
    {x: 0, y: -1.01, z: 0},
    {x: 0, y: 0, z: 1.01},
    {x: 0, y: 0, z: -1.01},
    {x: NaN, y: 0, z: 0},
  ])
    assert.equal(scene(point, 800, 600, 100, 20).visible, false);
});
test('visible edge anchors retain readable text and recover after panning', () => {
  assert.deepEqual(scene({x: 1, y: 1, z: 0}, 800, 600, 100, 20, 24, 27), {visible: true, x: 696, y: 27});
  assert.equal(scene({x: 4, y: 0, z: 0}, 800, 600, 100, 20).visible, false);
  assert.deepEqual(scene({x: 0, y: 0, z: 0}, 800, 600, 100, 20), {visible: true, x: 400, y: 300});
});
