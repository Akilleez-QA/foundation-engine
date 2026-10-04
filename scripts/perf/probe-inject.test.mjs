// The bench's page probe (probe-inject.mjs) run in a node:vm page double: a fake WebGL prototype, rAF and hashchange.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PROBE} from './probe-inject.mjs';

/** A page with WebGL prototypes the probe wraps, a manual rAF queue and hashchange listeners. */
function page() {
  const frames = [],
    listeners = new Map();
  const glProto = () => {
    const P = {};
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'bindFramebuffer'])
      P[f] = () => {};
    for (const f of ['viewport', 'activeTexture', 'bindTexture', 'texImage2D', 'texSubImage2D', 'texStorage2D'])
      P[f] = () => {};
    for (const f of ['compressedTexImage2D', 'generateMipmap', 'deleteTexture', 'useProgram', 'linkProgram'])
      P[f] = () => {};
    P.createTexture = () => ({});
    P.bufferSubData = () => {};
    P.bindVertexArray = () => {};
    return P;
  };
  const GL1 = function () {},
    GL2 = function () {};
  GL1.prototype = glProto();
  GL2.prototype = glProto();
  const Doc = function () {};
  Doc.prototype.createElement = () => ({});
  const sandbox = {
    WebGLRenderingContext: GL1,
    WebGL2RenderingContext: GL2,
    Document: Doc,
    performance: {now: () => 0},
    location: {hash: '#scene/a'},
    requestAnimationFrame: cb => frames.push(cb),
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PROBE, sandbox);
  const gl = new GL2();
  return {
    w: sandbox,
    /** One displayed frame: the probe's monitor ticks first (it registered first), then `draw` renders. */
    frame(draw = () => {}) {
      const due = frames.splice(0);
      for (const cb of due) cb(0);
      draw(gl);
    },
    hashchange(hash) {
      sandbox.location.hash = hash;
      for (const fn of listeners.get('hashchange') ?? []) fn();
    },
  };
}
/** A frame with a shadow pass: `casters` draws into a framebuffer, then the main pass. */
const shadowed = casters => gl => {
  gl.bindFramebuffer(36160, {});
  for (let i = 0; i < casters; i++) gl.drawElements(4, 3, 5123, 0);
  gl.bindFramebuffer(36160, null);
  gl.drawElements(4, 3, 5123, 0);
};
const plain = gl => gl.drawElements(4, 3, 5123, 0);

test('shadow casters and passes: the busiest frame of the scene that drew it', () => {
  const p = page();
  p.frame(shadowed(7));
  p.frame();
  assert.equal(p.w.__offMax, 7);
  assert.equal(p.w.__passMax, 1);
});

test("a scene change never attributes the previous scene's last frame to the next scene", () => {
  const p = page();
  p.frame(shadowed(7));
  p.frame(shadowed(7)); // the monitor reads this frame's draws at its next tick
  p.hashchange('#scene/b');
  p.frame(plain); // first tick after the change: the old frame's 7 casters are in flight
  p.frame(plain);
  p.frame();
  assert.equal(p.w.__offMax, 0, 'scene b casts no shadow');
  assert.equal(p.w.__passMax, 0);
  // Its own shadow pass, after the change, still counts.
  p.frame(shadowed(3));
  p.frame();
  assert.equal(p.w.__offMax, 3);
  assert.equal(p.w.__passMax, 1);
});
