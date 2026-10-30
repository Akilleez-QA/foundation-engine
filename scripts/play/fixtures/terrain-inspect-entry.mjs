// Finite diagnostic wireframe consumer. Owns its selected variants; no frame loop or polling.
import {createSurface} from '../../../src/kits/terrain/surface.ts';
import {buildSurfaceChunk} from '../../../src/kits/terrain/chunk.ts';
import {prepareTerrainGeneration, createTerrainOwner} from '../../../src/kits/terrain/generation.ts';
import {inspectTerrain} from '../../../src/kits/terrain/inspect.ts';
const layout = [
  {key: 'left', startX: 0, startZ: 0, cellsX: 4, cellsZ: 8, stride: 1},
  {key: 'right', startX: 4, startZ: 0, cellsX: 4, cellsZ: 8, stride: 1},
];
const generation = revision =>
  prepareTerrainGeneration(
    createSurface({
      id: 'diagnostic',
      revision,
      seed: 1,
      baseHeight: revision,
      originX: 0,
      originZ: 0,
      cellsX: 8,
      cellsZ: 8,
      spacing: 1,
    }),
    layout,
  );
const first = generation(1),
  second = generation(2);
const owner = createTerrainOwner(first, {maxBytes: first.bytes + second.bytes});
const canvas = document.querySelector('canvas'),
  drawing = canvas.getContext('2d');
let displayedEpoch = 1,
  closed = false,
  draws = 0,
  builds = 0,
  resolvePending;
let views = first.chunks.map(({chunk}, index) =>
  index === 0 ? buildSurfaceChunk(first.surface, {...layout[index], stride: 2}) : chunk,
);
const paint = () => {
  document.querySelector('#selection').textContent =
    `Consumer-selected strides (left / right): ${views.map(chunk => chunk.stride).join(' / ')}. Prepared strides: 1 / 1.`;
  drawing.clearRect(0, 0, canvas.width, canvas.height);
  views.forEach(({mesh}, index) => {
    drawing.strokeStyle = index === 0 ? '#155e75' : '#7c3aed';
    for (let i = 0; i < mesh.indices.length; i += 3) {
      drawing.beginPath();
      for (let j = 0; j < 3; j++) {
        const vertex = mesh.indices[i + j] * 3;
        const x = 15 + mesh.positions[vertex] * 45,
          y = 15 + mesh.positions[vertex + 2] * 45;
        if (j === 0) drawing.moveTo(x, y);
        else drawing.lineTo(x, y);
      }
      drawing.closePath();
      drawing.stroke();
    }
  });
  draws++;
};
const display = () => ({
  epoch: displayedEpoch,
  tiles: views.map((chunk, index) => ({
    index,
    stride: chunk.stride,
    vertices: chunk.mesh.positions.length / 3,
    triangles: chunk.mesh.indices.length / 3,
  })),
});
paint();
window.terrainInspect = {
  inspect: (epoch = owner.current.epoch, displayEpoch = displayedEpoch) =>
    inspectTerrain(owner, {
      expectedEpoch: epoch,
      displayed: {...display(), epoch: displayEpoch},
      sample: {x: 1, z: 1},
      limit: 1,
    }),
  begin() {
    return owner.request(2, second.bytes, () => {
      builds++;
      return new Promise(resolve => {
        resolvePending = resolve;
      });
    });
  },
  complete() {
    resolvePending(second);
  },
  publish() {
    return owner.publish(next => {
      views = next.chunks.map(({chunk}) => chunk);
      displayedEpoch = next.epoch;
      paint();
      return true;
    });
  },
  state: () => ({...owner.stats(), displayedEpoch, draws, builds, closed}),
  close() {
    owner.close();
    closed = true;
    views = [];
    drawing.clearRect(0, 0, canvas.width, canvas.height);
  },
};
