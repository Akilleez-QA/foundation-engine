// Finite intended-use consumer: creator policy retains accepted geometry during replacement.
// This is not a general publication framework, Surface facade, worker adapter or frame loop.
import * as THREE from 'three';
import {createTerrainRegion} from '../../../src/kits/terrain/region.ts';
import {createTerrainCoverage} from '../../../src/kits/terrain/region-coverage.ts';
const canvas = document.querySelector('canvas'),
  caption = document.querySelector('#status');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1);
renderer.setSize(1000, 660);
renderer.setClearColor('#101827');
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(42, 1000 / 660, 0.1, 150);
camera.position.set(19, 18, 22);
camera.lookAt(0, 1.5, 0);
scene.add(new THREE.HemisphereLight(0xd7eeff, 0x26334b, 2));
const sunlight = new THREE.DirectionalLight(0xffe5bd, 3);
sunlight.position.set(-8, 18, 10);
scene.add(sunlight);
const layout = [
  [-8, -8],
  [0, -8],
  [-8, 0],
  [0, 0],
].map(([startX, startZ], i) => ({id: `region-${i}`, startX, startZ, cellsX: 8, cellsZ: 8}));
const edit = {gx: 1, gz: 0};
const descriptor = revision => ({id: 'shared-lattice', revision, baseX: 0, baseZ: 0, spacing: 1});
const source = revision => p => ({
  height: (p.x * p.x) / 32 + (p.z * p.z) / 16 + (revision === 2 && p.gx === edit.gx && p.gz === edit.gz ? 3 : 0),
});
const build = revision =>
  layout.map(options => createTerrainRegion({...options, lattice: descriptor(revision)}, source(revision)));
let accepted = build(1),
  candidates = null,
  phase = 'accepted',
  revision = 1,
  builds = 4,
  draws = 0,
  closed = false;
const unavailable = {status: 'unavailable', id: 'not-loaded', extent: {minX: 12, minZ: -8, maxX: 20, maxZ: 8}};
const coverage = regions => createTerrainCoverage([...regions.map(region => ({status: 'ready', region})), unavailable]);
let acceptedCoverage = coverage(accepted),
  desiredCoverage = acceptedCoverage;
const colors = [0x49c9c0, 0x619ff1, 0xaf83e7, 0xf2bc76];
function makeView(regions) {
  const group = new THREE.Group();
  regions.forEach((region, i) => {
    const data = region.mesh(),
      geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setIndex(data.indices);
    const solid = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({color: colors[i], roughness: 0.85, metalness: 0}),
    );
    group.add(solid);
    const wire = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({color: 0x18243a, wireframe: true, transparent: true, opacity: 0.25}),
    );
    group.add(wire);
  });
  return group;
}
function retireView(view) {
  const geometry = new Set();
  for (const child of view.children) {
    geometry.add(child.geometry);
    child.material.dispose();
  }
  for (const item of geometry) item.dispose();
}
let view = makeView(accepted);
scene.add(view);
function paint() {
  caption.textContent = `Accepted revision ${revision} · ${phase} · four independent cores · one-cell private halos`;
  renderer.render(scene, camera);
  draws++;
}
function oracle(regions, version) {
  const monolith = createTerrainRegion(
    {id: 'monolith', lattice: descriptor(version), startX: -8, startZ: -8, cellsX: 16, cellsZ: 16},
    source(version),
  );
  let maxPositionError = 0,
    maxNormalError = 0,
    sharedVertices = 0;
  const seen = new Map();
  for (const region of regions)
    for (let z = 0; z <= 8; z++)
      for (let x = 0; x <= 8; x++) {
        const actual = region.vertex(x, z),
          gx = region.startX + x,
          gz = region.startZ + z,
          expected = monolith.vertex(gx + 8, gz + 8);
        maxPositionError = Math.max(
          maxPositionError,
          Math.abs(actual.x - expected.x),
          Math.abs(actual.y - expected.y),
          Math.abs(actual.z - expected.z),
        );
        for (const axis of ['x', 'y', 'z'])
          maxNormalError = Math.max(maxNormalError, Math.abs(actual.normal[axis] - expected.normal[axis]));
        const key = `${gx},${gz}`,
          previous = seen.get(key);
        if (previous) {
          sharedVertices++;
          for (const axis of ['x', 'y', 'z'])
            maxNormalError = Math.max(maxNormalError, Math.abs(previous.normal[axis] - actual.normal[axis]));
        } else seen.set(key, actual);
      }
  const origin = regions[0].vertex(8, 8).normal,
    expectedNormal = version === 2 ? [-2 / 3, 2 / 3, -1 / 3] : [0, 1, 0];
  const editOracleError = Math.max(...['x', 'y', 'z'].map((axis, i) => Math.abs(origin[axis] - expectedNormal[i])));
  return {maxPositionError, maxNormalError, sharedVertices, editOracleError, originNormal: origin};
}
let acceptedOracle = oracle(accepted, revision);
function state() {
  return {
    phase,
    revision,
    draws,
    builds,
    closed,
    candidateCount: candidates?.length ?? 0,
    acceptedRevisions: accepted.map(r => r.lattice.revision),
    acceptedHeight: acceptedCoverage.query(1, 1).sample?.height,
    acceptedQuery: acceptedCoverage.query(1, 1).status,
    desiredQuery: desiredCoverage.query(1, 1).status,
    unavailable: desiredCoverage.query(15, 0).status,
    outside: desiredCoverage.query(30, 30).status,
    seam: acceptedCoverage.query(0, 0).status,
    oracle: acceptedOracle,
  };
}
paint();
window.terrainRegions = {
  state,
  begin() {
    if (closed || phase !== 'accepted') return false;
    phase = 'pending';
    desiredCoverage = createTerrainCoverage([
      ...accepted.map(region => ({status: 'pending', id: region.id, extent: region.extent})),
      unavailable,
    ]);
    paint();
    return true;
  },
  complete() {
    if (closed || phase !== 'pending') return false;
    const affected = accepted.filter(
      region =>
        edit.gx >= region.dependency.minX &&
        edit.gx <= region.dependency.maxX &&
        edit.gz >= region.dependency.minZ &&
        edit.gz <= region.dependency.maxZ,
    );
    if (affected.length !== 4) throw Error('edit must rebuild every halo-dependent region');
    candidates = affected.map(region =>
      createTerrainRegion({...layout.find(item => item.id === region.id), lattice: descriptor(2)}, source(2)),
    );
    builds += candidates.length;
    phase = 'ready';
    paint();
    return true;
  },
  publish() {
    if (closed || phase !== 'ready' || candidates?.length !== 4) return false;
    const check = oracle(candidates, 2);
    if (check.maxPositionError > 1e-12 || check.maxNormalError > 1e-12 || check.editOracleError > 1e-12)
      throw Error('candidate seam oracle failed');
    const replacement = makeView(candidates),
      nextCoverage = coverage(candidates),
      previous = view;
    scene.add(replacement);
    scene.remove(previous);
    view = replacement;
    accepted = candidates;
    candidates = null;
    acceptedCoverage = nextCoverage;
    desiredCoverage = nextCoverage;
    revision = 2;
    acceptedOracle = check;
    phase = 'accepted';
    retireView(previous);
    paint();
    return true;
  },
  close() {
    if (closed) return;
    closed = true;
    scene.remove(view);
    retireView(view);
    renderer.dispose();
    candidates = null;
  },
};
