const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/ui/graph-model');

function note(path, extra) {
  return {
    path,
    title: path,
    workspace: null,
    tags: [],
    modifiedAt: 0,
    degreeIn: 0,
    degreeOut: 0,
    orphan: true,
    broken: 0,
    ...extra,
  };
}

test('o raio cresce com degreeIn + degreeOut e fica entre o mínimo e o máximo', () => {
  assert.equal(model.nodeRadius(0), model.RADIUS_MIN);
  assert.equal(model.nodeRadius({ degreeIn: 0, degreeOut: 0 }), model.RADIUS_MIN);
  assert.equal(model.nodeRadius({ degreeIn: 20, degreeOut: 20 }), model.RADIUS_MAX);
  const one = model.nodeRadius({ degreeIn: 1, degreeOut: 0 });
  const four = model.nodeRadius({ degreeIn: 2, degreeOut: 2 });
  const nine = model.nodeRadius({ degreeIn: 4, degreeOut: 5 });
  assert.ok(one > model.RADIUS_MIN);
  assert.ok(four > one);
  assert.ok(nine > four);
  assert.ok(nine < model.RADIUS_MAX);
  assert.equal(model.degreeOf({ degreeIn: 3, degreeOut: 6 }), 9);
});

test('o esmaecimento é 0,4 no nó e 0,22 na aresta, em 150–200 ms', () => {
  assert.equal(model.fadeOpacity('node'), 0.4);
  assert.equal(model.fadeOpacity('edge'), 0.22);
  assert.equal(model.fadeOpacity('hot'), 1);
  assert.ok(model.FADE_MS >= 150 && model.FADE_MS <= 200);
  assert.equal(model.mixOpacity(1, 0.4, 0, model.FADE_MS), 1);
  assert.equal(model.mixOpacity(1, 0.4, model.FADE_MS, model.FADE_MS), 0.4);
  assert.ok(Math.abs(model.mixOpacity(1, 0.4, model.FADE_MS / 2, model.FADE_MS) - 0.7) < 1e-9);
  assert.equal(model.mixOpacity(1, 0.22, 0, 0), 0.22);
});

test('mais links no par encurtam a mola e aumentam a força', () => {
  assert.equal(model.restLength(80, 1), 80);
  assert.equal(model.restLength(80, 4), 40);
  assert.ok(model.restLength(80, 3) < model.restLength(80, 1));
  assert.equal(model.springGain(1, 1), 1);
  assert.equal(model.springGain(1, 4), 4);
  assert.ok(model.springGain(0.5, 2) > model.springGain(0.5, 1));
  assert.equal(model.linkWeight(undefined), 1);
  const loose = distanceAfter({ weight: 1 });
  const tight = distanceAfter({ weight: 4 });
  assert.ok(Math.abs(loose - 80) < 8, `distância com 1 link: ${loose}`);
  assert.ok(tight < loose - 15, `4 links deveriam aproximar: ${tight} vs ${loose}`);
});

test('a força da estante começa em 0 e os sliders ficam na faixa', () => {
  assert.equal(model.DEFAULT_FORCES.shelf, 0);
  assert.equal(model.DEFAULT_FORCES.spring, 1);
  assert.equal(model.DEFAULT_FORCES.length, 80);
  const forces = model.normalizeForces({
    spring: 9,
    length: 1,
    repulsion: -1,
    center: 3,
    shelf: 0.7,
  });
  assert.equal(forces.spring, 2);
  assert.equal(forces.length, 16);
  assert.equal(forces.repulsion, 0);
  assert.equal(forces.center, 1);
  assert.equal(forces.shelf, 0.7);
  const prefs = model.prefsShape({ forces: { shelf: 4 }, mode: 'local', depth: 3, arrows: true });
  assert.equal(prefs.forces.shelf, 1);
  assert.equal(prefs.mode, 'local');
  assert.equal(prefs.depth, 3);
  assert.equal(prefs.arrows, true);
});

test('filtros de estante, tag, órfã, canvas e anexo ficam no front', () => {
  const graph = {
    nodes: [
      note('Estudos/Memoria.md', {
        workspace: 'Estudos',
        tags: ['estudo'],
        degreeOut: 2,
        orphan: false,
        modifiedAt: 10,
        broken: 1,
      }),
      note('Estudos/Feynman.md', {
        workspace: 'Estudos',
        degreeIn: 1,
        orphan: false,
        modifiedAt: 20,
      }),
      note('Trabalho/Reuniao.md', {
        workspace: 'Trabalho',
        degreeIn: 1,
        orphan: false,
        modifiedAt: 30,
      }),
      note('Solta.md', { workspace: null, modifiedAt: 40 }),
      note('Mapa.canvas', { workspace: 'Estudos', degreeOut: 1, orphan: false, modifiedAt: 15 }),
      note('foto.png', { workspace: 'Estudos', modifiedAt: 12 }),
    ],
    edges: [
      { from: 'Estudos/Memoria.md', to: 'Estudos/Feynman.md', weight: 2, format: 'wiki' },
      { from: 'Estudos/Memoria.md', to: 'Trabalho/Reuniao.md', weight: 1, format: 'wiki' },
      { from: 'Mapa.canvas', to: 'Estudos/Memoria.md', weight: 1, format: 'wiki' },
    ],
  };
  const all = model.applyFilters(graph, {});
  assert.deepEqual(all.nodes.map((node) => node.path).sort(), [
    'Estudos/Feynman.md',
    'Estudos/Memoria.md',
    'Solta.md',
    'Trabalho/Reuniao.md',
  ]);
  assert.equal(all.counts.links, 2);
  assert.equal(model.nodeKind(all.nodes.find((node) => node.path === 'Solta.md')), 'note');
  const withCanvas = model.applyFilters(graph, { showCanvas: true, showAttachments: true });
  assert.equal(
    withCanvas.nodes.some((node) => node.kind === 'canvas'),
    true,
  );
  assert.equal(
    withCanvas.nodes.some((node) => node.kind === 'attachment'),
    true,
  );
  const shelf = model.applyFilters(graph, { shelves: ['Estudos'] });
  assert.ok(shelf.nodes.every((node) => node.workspace === 'Estudos'));
  assert.equal(
    shelf.nodes.some((node) => node.path === 'Solta.md'),
    false,
  );
  const orphans = model.applyFilters(graph, { hideOrphans: true });
  assert.equal(
    orphans.nodes.some((node) => node.path === 'Solta.md'),
    false,
  );
  const tagged = model.applyFilters(graph, { tag: '#estudo' });
  assert.deepEqual(
    tagged.nodes.map((node) => node.path),
    ['Estudos/Memoria.md'],
  );
  assert.equal(tagged.counts.links, 0);
  const early = model.applyFilters(graph, { until: 0 });
  assert.deepEqual(
    early.nodes.map((node) => node.path),
    ['Estudos/Memoria.md'],
  );
});

test('a seta de saída cita e a de entrada é citada por', () => {
  const edge = { from: 'A.md', to: 'B.md', weight: 1 };
  assert.equal(model.edgeRole(edge, null), null);
  assert.equal(model.edgeRole(edge, 'A.md'), 'out');
  assert.equal(model.edgeRole(edge, 'B.md'), 'in');
  assert.equal(model.edgeRole(edge, 'C.md'), null);
  const around = model.highlightSet('A.md', [edge, { from: 'C.md', to: 'A.md', weight: 1 }]);
  assert.deepEqual([...around].sort(), ['A.md', 'B.md', 'C.md']);
});

test('um nó fixo não anda e a repulsão afasta os soltos', () => {
  const sim = model.createSimulation([note('a', { x: 0, y: 0 }), note('b', { x: 30, y: 0 })], [], {
    positions: { a: { x: 0, y: 0, pinned: true } },
    forces: { spring: 0, length: 80, repulsion: 1, center: 0, shelf: 0 },
  });
  for (let step = 0; step < 30; step += 1) model.stepForces(sim.bodies, sim.edges, sim.forces, 1);
  const pinned = sim.bodies.find((body) => body.path === 'a');
  const loose = sim.bodies.find((body) => body.path === 'b');
  assert.equal(pinned.x, 0);
  assert.equal(pinned.y, 0);
  assert.ok(loose.x > 30);
});

function distanceAfter(edge) {
  const sim = model.createSimulation(
    [
      note('a', { x: -300, y: 0, degreeOut: edge.weight, orphan: false }),
      note('b', { x: 300, y: 0, degreeIn: edge.weight, orphan: false }),
    ],
    [{ from: 'a', to: 'b', weight: edge.weight, format: 'wiki' }],
    { forces: { spring: 1, length: 80, repulsion: 0, center: 0, shelf: 0 } },
  );
  for (let step = 0; step < 500; step += 1) model.stepForces(sim.bodies, sim.edges, sim.forces, 1);
  return Math.hypot(sim.bodies[0].x - sim.bodies[1].x, sim.bodies[0].y - sim.bodies[1].y);
}
