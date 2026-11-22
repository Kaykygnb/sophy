const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../src/ui/graph-view.js'), 'utf8'),
  context,
);
const { localGraph, buildScene } = context.window.SophyGraphView;
const Sim = require('../src/ui/graph-sim.js');
const plain = (value) => JSON.parse(JSON.stringify(value));

const graph = {
  nodes: ['A', 'B', 'C', 'D', 'Orfa'].map((name) => ({ path: `${name}.md`, title: name })),
  edges: [
    { from: 'A.md', to: 'B.md' },
    { from: 'B.md', to: 'C.md' },
    { from: 'D.md', to: 'C.md' },
  ],
};

test('modo local inclui vizinhos até a profundidade escolhida', () => {
  assert.deepEqual(plain(localGraph(graph, 'A.md', 1).nodes.map((node) => node.path)), [
    'A.md',
    'B.md',
  ]);
  assert.deepEqual(plain(localGraph(graph, 'A.md', 1).edges), [{ from: 'A.md', to: 'B.md' }]);
  assert.deepEqual(plain(localGraph(graph, 'A.md', 2).nodes.map((node) => node.path)), [
    'A.md',
    'B.md',
    'C.md',
  ]);
  assert.deepEqual(plain(localGraph(graph, 'Orfa.md', 3).edges), []);
  assert.equal(localGraph(graph, null, 2), graph);
});

const library = {
  nodes: [
    {
      path: 'Estudos/A.md',
      title: 'A',
      workspace: 'Estudos',
      tags: ['estudo', 'estudo/memoria'],
      createdAt: '2026-01-01T09:00:00',
    },
    {
      path: 'Estudos/B.md',
      title: 'B',
      workspace: 'Estudos',
      tags: ['estudo'],
      createdAt: '2026-02-01T09:00:00',
    },
    {
      path: 'Trabalho/C.md',
      title: 'C',
      workspace: 'Trabalho',
      tags: ['estudo'],
      createdAt: '2026-03-01T09:00:00',
    },
    {
      path: 'Trabalho/D.md',
      title: 'D',
      workspace: 'Trabalho',
      tags: [],
      createdAt: '2026-04-01T09:00:00',
    },
  ],
  edges: [
    { from: 'Estudos/A.md', to: 'Estudos/B.md', format: 'wiki' },
    {
      from: 'Estudos/A.md',
      to: 'Trabalho/C.md',
      format: 'wiki',
      target: { kind: 'block', anchor: 'api' },
    },
    { from: 'Estudos/B.md', to: 'Trabalho/C.md', format: 'wiki' },
    { from: 'Trabalho/C.md', to: 'Trabalho/D.md', format: 'child' },
  ],
};

test('cena de notas: tipos de ligação e aglomerado por estante', () => {
  const scene = buildScene(library, { view: 'notas' });
  assert.equal(scene.nodes.length, 4);
  assert.deepEqual(plain(scene.links.map((link) => link.kind).sort()), [
    'block',
    'child',
    'wiki',
    'wiki',
  ]);
  assert.equal(scene.nodes.find((node) => node.path === 'Trabalho/C.md').cluster, 'Trabalho');
  const withTags = buildScene(library, { view: 'notas', edgeKinds: { tag: true } });
  assert.ok(withTags.links.some((link) => link.kind === 'tag' && link.tag === 'estudo'));
});

test('modo Estantes agrega as ligações e expande uma estante', () => {
  const scene = buildScene(library, { view: 'estantes' });
  assert.deepEqual(plain(scene.nodes.map((node) => [node.id, node.count]).sort()), [
    ['s:Estudos', 2],
    ['s:Trabalho', 2],
  ]);
  const between = scene.links.filter((link) => link.kind === 'shelf');
  assert.equal(between.length, 1);
  assert.equal(between[0].weight, 2);
  const open = buildScene(library, { view: 'estantes', expanded: new Set(['Estudos']) });
  assert.ok(open.nodes.some((node) => node.id === 'n:Estudos/A.md'));
  assert.ok(open.nodes.some((node) => node.id === 's:Trabalho'));
  assert.ok(
    open.links.some(
      (link) =>
        link.kind === 'wiki' &&
        link.source === 'n:Estudos/A.md' &&
        link.target === 'n:Estudos/B.md',
    ),
  );
});

test('modo Tags cria pontos de tag com a hierarquia', () => {
  const scene = buildScene(library, { view: 'tags' });
  const tags = scene.nodes.filter((node) => node.kind === 'tag');
  assert.deepEqual(plain(tags.map((node) => node.tag).sort()), ['estudo', 'estudo/memoria']);
  assert.equal(tags.find((node) => node.tag === 'estudo').count, 3);
  assert.ok(scene.links.some((link) => link.kind === 'tagtree'));
  assert.equal(scene.links.filter((link) => link.kind === 'member').length, 4);
});

test('linha do tempo: só notas criadas até a data, ligações só com as duas pontas', () => {
  const scene = buildScene(library, { view: 'notas', until: Date.parse('2026-02-15T00:00:00') });
  assert.deepEqual(plain(scene.nodes.map((node) => node.path)), ['Estudos/A.md', 'Estudos/B.md']);
  assert.equal(scene.links.length, 1);
});

test('simulação: nenhum par de nós sobreposto e nó preso fica no lugar', () => {
  const sim = Sim.create();
  const nodes = Array.from({ length: 220 }, (_, i) => ({
    id: `n${i}`,
    x: Math.cos(i) * 20,
    y: Math.sin(i) * 20,
    r: 5 + (i % 9),
    cluster: `s${i % 4}`,
  }));
  nodes.forEach((node) => (node.cr = node.r + 4));
  nodes[0].fx = 12;
  nodes[0].fy = 34;
  sim.setNodes(nodes);
  sim.setLinks(
    nodes.slice(1).map((node, i) => ({ source: node.id, target: `n${Math.floor(i / 3)}` })),
  );
  sim.run(600);
  for (let i = 0; i < nodes.length; i += 1)
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i],
        b = nodes[j];
      assert.ok(
        Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 0.01,
        `${a.id} e ${b.id} se sobrepõem`,
      );
    }
  assert.deepEqual([nodes[0].x, nodes[0].y], [12, 34]);
  assert.ok(nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
});
