import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { EngineError } from './errors.ts';
import { queryGraph, type GraphEdge, type GraphNode } from './graph.ts';
import { openLibrary, type Library } from './library.ts';
import { callTool } from './tools.ts';

function tempLibrary() {
  return openLibrary(fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-graph-')));
}

function write(library: Library, relative: string, content: string) {
  const full = path.join(library.root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function node(nodes: GraphNode[], file: string) {
  const found = nodes.find((item) => item.path === file);
  assert.ok(found, file);
  return found;
}

function edge(edges: GraphEdge[], from: string, to: string) {
  const found = edges.filter((item) => item.from === from && item.to === to);
  assert.equal(found.length, 1, `${from} -> ${to}`);
  return found[0];
}

test('links repetidos no mesmo par viram uma aresta com weight 2', () => {
  const library = tempLibrary();
  write(library, 'Destino.md', '# Destino\n');
  write(library, 'Origem.md', '[[Destino]]\n[[Destino]]\n');
  const graph = queryGraph(library);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(edge(graph.edges, 'Origem.md', 'Destino.md'), {
    from: 'Origem.md',
    to: 'Destino.md',
    format: 'wiki',
    weight: 2,
  });
  const origin = node(graph.nodes, 'Origem.md');
  const destino = node(graph.nodes, 'Destino.md');
  assert.equal(origin.degreeOut, 2);
  assert.equal(destino.degreeIn, 2);
  assert.equal(origin.orphan, false);
});

test('format da aresta agregada é o do primeiro link do par', () => {
  const library = tempLibrary();
  write(library, 'Destino.md', '# Destino\n');
  write(library, 'Origem.md', '[[Destino]] e depois ![[Destino]]\n');
  const graph = queryGraph(library);
  const found = edge(graph.edges, 'Origem.md', 'Destino.md');
  assert.equal(found.format, 'wiki');
  assert.equal(found.weight, 2);
  assert.equal(originDegree(graph.nodes, 'Origem.md'), 2);
});

test('[[nota|alias]] e [[nota#título]] ligam a nota, e âncora ausente conta como broken', () => {
  const library = tempLibrary();
  write(library, 'Nota.md', '# Título\n\ncorpo\n');
  write(library, 'Alias.md', 'Veja [[Nota|o outro]].\n');
  write(library, 'Ancora.md', 'Veja [[Nota#Título]].\n');
  write(library, 'Ausente.md', 'Veja [[Nota#Não tem]].\n');
  const graph = queryGraph(library);
  assert.deepEqual(edge(graph.edges, 'Alias.md', 'Nota.md'), {
    from: 'Alias.md',
    to: 'Nota.md',
    format: 'wiki',
    weight: 1,
  });
  assert.deepEqual(edge(graph.edges, 'Ancora.md', 'Nota.md'), {
    from: 'Ancora.md',
    to: 'Nota.md',
    format: 'wiki',
    weight: 1,
  });
  assert.equal(
    graph.edges.some((item) => item.from === 'Ausente.md'),
    false,
  );
  assert.equal(node(graph.nodes, 'Ausente.md').broken, 1);
  assert.equal(node(graph.nodes, 'Nota.md').degreeIn, 2);
});

test('canvas entra como nó e como aresta', () => {
  const library = tempLibrary();
  write(library, 'Leitura.md', '# Leitura\n');
  write(
    library,
    'Mapa.canvas',
    JSON.stringify({
      nodes: [
        {
          id: 'texto',
          type: 'text',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          text: 'Veja [[Leitura]]',
        },
        {
          id: 'arquivo',
          type: 'file',
          x: 40,
          y: 40,
          width: 200,
          height: 80,
          file: 'Leitura.md',
        },
      ],
      edges: [],
    }),
  );
  const graph = queryGraph(library);
  const canvas = node(graph.nodes, 'Mapa.canvas');
  assert.equal(canvas.workspace, null);
  assert.equal(canvas.orphan, false);
  assert.deepEqual(edge(graph.edges, 'Mapa.canvas', 'Leitura.md'), {
    from: 'Mapa.canvas',
    to: 'Leitura.md',
    format: 'wiki',
    weight: 2,
  });
});

test('cofre antigo sem estantes, sem frontmatter e com alias singular', () => {
  const source = fileURLToPath(new URL('./fixtures/cofre-antigo', import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-antigo-'));
  const target = path.join(root, 'cofre');
  fs.cpSync(source, target, { recursive: true });
  assert.equal(
    fs.existsSync(path.join(target, '.sophy', 'lixeira', 'Descartada.md')),
    true,
  );
  const graph = queryGraph(openLibrary(target));
  assert.deepEqual(
    graph.nodes.map((item) => item.path),
    ['AliasSingular.md', 'Orfa.md', 'SemFrontmatter.md'],
  );
  for (const item of graph.nodes) {
    assert.equal(item.workspace, null);
    assert.deepEqual(item.tags, []);
  }
  const plain = node(graph.nodes, 'SemFrontmatter.md');
  assert.equal(plain.title, 'Sem frontmatter');
  assert.equal(plain.degreeIn, 1);
  assert.equal(plain.orphan, false);
  const named = node(graph.nodes, 'AliasSingular.md');
  assert.equal(named.title, 'Com alias');
  assert.equal(named.degreeOut, 1);
  assert.deepEqual(edge(graph.edges, 'AliasSingular.md', 'SemFrontmatter.md'), {
    from: 'AliasSingular.md',
    to: 'SemFrontmatter.md',
    format: 'wiki',
    weight: 1,
  });
  const alone = node(graph.nodes, 'Orfa.md');
  assert.equal(alone.title, 'Orfa');
  assert.equal(alone.orphan, true);
  assert.equal(alone.degreeIn, 0);
  assert.equal(alone.degreeOut, 0);
  assert.equal(alone.broken, 0);
  assert.equal(
    graph.nodes.some((item) => item.path.split('/').includes('.sophy')),
    false,
  );
  assert.equal(
    graph.edges.some((item) => item.from.includes('.sophy') || item.to.includes('.sophy')),
    false,
  );
});

test('o grafo ignora .sophy e mantém uma pasta chamada sophy', () => {
  const library = tempLibrary();
  write(library, 'Raiz.md', '# Raiz\n');
  write(library, 'sophy/Nota.md', '# Nota\n\n[[Raiz]]\n');
  write(library, '.sophy/lixeira/Velha.md', '# Velha\n\n[[Raiz]]\n[[Sumiu]]\n');
  write(library, '.sophy/Oculta.md', '[[Raiz]]\n');
  const graph = queryGraph(library);
  assert.deepEqual(
    graph.nodes.map((item) => item.path),
    ['Raiz.md', 'sophy/Nota.md'],
  );
  assert.equal(node(graph.nodes, 'sophy/Nota.md').workspace, 'sophy');
  assert.equal(node(graph.nodes, 'Raiz.md').degreeIn, 1);
  assert.equal(graph.edges.length, 1);
});

test('links quebrados e ambíguos entram em broken e não viram aresta', () => {
  const library = tempLibrary();
  write(library, 'Estudos/Nota.md', '# Nota\n');
  write(library, 'Livro/Nota.md', '# Nota\n');
  write(library, 'Raiz.md', '[[Nota]]\n[[Sumiu]]\n[[Sumiu]]\n[[Estudos/Nota#Ausente]]\n');
  const graph = queryGraph(library);
  const raiz = node(graph.nodes, 'Raiz.md');
  assert.equal(raiz.broken, 4);
  assert.equal(raiz.orphan, true);
  assert.equal(raiz.degreeOut, 0);
  assert.equal(
    graph.edges.some((item) => item.from === 'Raiz.md'),
    false,
  );
});

test('center e depth devolvem o subgrafo e recusam centro ausente ou fora do filtro', () => {
  const library = tempLibrary();
  write(library, 'A.md', '[[B]]\n');
  write(library, 'B.md', '[[C]]\n');
  write(library, 'C.md', '[[D]]\n');
  write(library, 'D.md', '[[E]]\n');
  write(library, 'E.md', 'fim\n');
  write(library, 'F.md', 'longe\n');
  write(library, 'X.md', 'alvo\n');
  write(library, 'Y.md', '[[X]]\n');

  const depth1 = queryGraph(library, { center: 'A.md' });
  assert.deepEqual(
    depth1.nodes.map((item) => item.path),
    ['A.md', 'B.md'],
  );
  assert.deepEqual(depth1.edges, [
    { from: 'A.md', to: 'B.md', format: 'wiki', weight: 1 },
  ]);

  const depth2 = queryGraph(library, { center: 'A.md', depth: 2 });
  assert.deepEqual(
    depth2.nodes.map((item) => item.path),
    ['A.md', 'B.md', 'C.md'],
  );
  assert.deepEqual(
    depth2.edges.map((item) => `${item.from}->${item.to}`),
    ['A.md->B.md', 'B.md->C.md'],
  );

  const depth3 = queryGraph(library, { center: 'A.md', depth: 3 });
  assert.deepEqual(
    depth3.nodes.map((item) => item.path),
    ['A.md', 'B.md', 'C.md', 'D.md'],
  );
  assert.equal(
    depth3.nodes.some((item) => item.path === 'E.md' || item.path === 'F.md'),
    false,
  );
  assert.deepEqual(
    depth3.edges.map((item) => `${item.from}->${item.to}`),
    ['A.md->B.md', 'B.md->C.md', 'C.md->D.md'],
  );

  const incoming = queryGraph(library, { center: 'X.md', depth: 1 });
  assert.deepEqual(
    incoming.nodes.map((item) => item.path),
    ['X.md', 'Y.md'],
  );
  assert.deepEqual(incoming.edges, [
    { from: 'Y.md', to: 'X.md', format: 'wiki', weight: 1 },
  ]);

  assert.throws(
    () => queryGraph(library, { center: 'Nao.md' }),
    (error: unknown) => {
      assert.ok(error instanceof EngineError);
      assert.equal((error as EngineError).code, 'not-found');
      assert.match((error as EngineError).message, /não existe/);
      return true;
    },
  );
  assert.throws(
    () => queryGraph(library, { center: 'A' }),
    (error: unknown) => {
      assert.match((error as Error).message, /não existe/);
      return true;
    },
  );
});

test('filtros de estante e tag valem antes do BFS', () => {
  const library = tempLibrary();
  write(
    library,
    'Estudos/Centro.md',
    '---\ntags:\n  - foco\n---\n[[Perto]]\n[[Longe]]\n[[SemTag]]\n',
  );
  write(library, 'Estudos/Perto.md', '---\ntags:\n  - foco\n---\n# Perto\n');
  write(library, 'Estudos/SemTag.md', '# Sem tag\n');
  write(library, 'Livro/Longe.md', '---\ntags:\n  - foco\n---\n# Longe\n');
  const byShelf = queryGraph(library, {
    workspace: 'Estudos',
    center: 'Estudos/Centro.md',
    depth: 3,
  });
  assert.deepEqual(
    byShelf.nodes.map((item) => item.path),
    ['Estudos/Centro.md', 'Estudos/Perto.md', 'Estudos/SemTag.md'],
  );
  assert.equal(
    byShelf.edges.some((item) => item.to === 'Livro/Longe.md'),
    false,
  );
  const byTag = queryGraph(library, { tag: 'foco', center: 'Estudos/Centro.md', depth: 2 });
  assert.deepEqual(
    byTag.nodes.map((item) => item.path),
    ['Estudos/Centro.md', 'Estudos/Perto.md', 'Livro/Longe.md'],
  );
  assert.throws(
    () => queryGraph(library, { workspace: 'Estudos', center: 'Livro/Longe.md' }),
    (error: unknown) => {
      assert.ok(error instanceof EngineError);
      assert.match((error as EngineError).message, /fora do filtro/);
      return true;
    },
  );
  assert.throws(
    () => queryGraph(library, { tag: 'foco', center: 'Estudos/SemTag.md' }),
    (error: unknown) => {
      assert.match((error as Error).message, /fora do filtro/);
      return true;
    },
  );
});

test('depth fora de 1 a 3 é erro de validação do zod', () => {
  const library = tempLibrary();
  write(library, 'A.md', '# A\n');
  for (const depth of [0, 4, -1, 1.5]) {
    assert.throws(
      () => callTool('graph.query', { libraryPath: library.root, depth }),
      (error: unknown) => {
        assert.ok(error instanceof z.ZodError, String(error));
        assert.match(error.issues.map((issue) => issue.message).join(' '), /1 a 3/);
        return true;
      },
    );
  }
  const full = callTool('graph.query', { libraryPath: library.root, depth: 2 }) as {
    nodes: Array<{ path: string }>;
  };
  assert.deepEqual(
    full.nodes.map((item) => item.path),
    ['A.md'],
  );
});

test('campos antigos do nó e da aresta continuam no lugar', () => {
  const library = tempLibrary();
  write(library, 'Nota.md', '---\ntags:\n  - animal\n---\n# Gato\n');
  write(library, 'Outra.md', 'Veja [[Nota]]\n');
  const graph = queryGraph(library);
  const note = node(graph.nodes, 'Nota.md');
  assert.deepEqual(Object.keys(note), [
    'path',
    'title',
    'workspace',
    'tags',
    'modifiedAt',
    'degreeIn',
    'degreeOut',
    'orphan',
    'broken',
  ]);
  assert.equal(note.path, 'Nota.md');
  assert.equal(note.title, 'Gato');
  assert.equal(note.workspace, null);
  assert.deepEqual(note.tags, ['animal']);
  assert.equal(typeof note.modifiedAt, 'number');
  const found = edge(graph.edges, 'Outra.md', 'Nota.md');
  assert.deepEqual(Object.keys(found), ['from', 'to', 'format', 'weight']);
  assert.equal(found.from, 'Outra.md');
  assert.equal(found.to, 'Nota.md');
  assert.equal(found.format, 'wiki');
});

function originDegree(nodes: GraphNode[], file: string) {
  return node(nodes, file).degreeOut;
}
