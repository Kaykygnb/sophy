const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/ui/graph-view.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const { localGraph } = context.window.SophyGraphView;
const workerSource = fs.readFileSync(path.join(__dirname, '../src/ui/graph-worker.js'), 'utf8');

const graph = {
  nodes: ['A', 'B', 'C', 'D', 'Orfa'].map((name) => ({ path: `${name}.md`, title: name })),
  edges: [
    { from: 'A.md', to: 'B.md' },
    { from: 'B.md', to: 'C.md' },
    { from: 'D.md', to: 'C.md' },
  ],
};

test('modo local inclui vizinhos até a profundidade escolhida', () => {
  const one = localGraph(graph, 'A.md', 1);
  assert.deepEqual(JSON.parse(JSON.stringify(one.nodes.map((node) => node.path))), [
    'A.md',
    'B.md',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(one.edges)), [{ from: 'A.md', to: 'B.md' }]);
  const two = localGraph(graph, 'A.md', 2);
  assert.deepEqual(JSON.parse(JSON.stringify(two.nodes.map((node) => node.path))), [
    'A.md',
    'B.md',
    'C.md',
  ]);
});

test('nota isolada permanece no centro local sem arestas', () => {
  const local = localGraph(graph, 'Orfa.md', 3);
  assert.deepEqual(JSON.parse(JSON.stringify(local.nodes.map((node) => node.path))), ['Orfa.md']);
  assert.deepEqual(JSON.parse(JSON.stringify(local.edges)), []);
});

test('sem nota central, o modo local mantém o conjunto recebido', () => {
  assert.equal(localGraph(graph, null, 2), graph);
});

test('worker estabiliza o conjunto e conserva nós fixados', async () => {
  const messages = [];
  const worker = {
    postMessage: (message) => messages.push(message),
    setTimeout: (callback) => queueMicrotask(callback),
  };
  vm.runInNewContext(workerSource, worker);
  const fixed = { x: 12, y: 34, pinned: true };
  worker.onmessage({
    data: {
      type: 'init',
      nodes: [fixed, { x: 80, y: 80 }, { x: 180, y: 80 }],
      links: [
        [0, 1],
        [1, 2],
      ],
      options: { width: 640, height: 480 },
      running: true,
    },
  });
  await new Promise((resolve) => {
    const poll = () =>
      messages.some((message) => message.type === 'positions' && message.done)
        ? resolve()
        : setTimeout(poll, 0);
    poll();
  });
  const final = messages.at(-1);
  assert.equal(final.type, 'positions');
  assert.deepEqual(Array.from(final.positions[0]), [12, 34]);
  assert.ok(final.positions.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
});
