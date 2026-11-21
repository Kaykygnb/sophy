import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { linkGeneration } from './links.ts';
import { callTool } from './tools.ts';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-links-'));
  const root = path.join(home, 'biblioteca');
  fs.mkdirSync(root);
  return { home, root };
}

function create(root: string, file: string, body: string, frontmatter?: Record<string, unknown>) {
  return callTool('note.create', {
    libraryPath: root,
    path: file,
    body,
    frontmatter,
    origin: 'ui',
  }) as {
    path: string;
    revision: string;
    body: string;
  };
}

test('nome único resolve, caminho desambigua, âncora e embed', () => {
  const { home, root } = fixture();
  create(root, 'Estudos/Nota.md', '# Titulo\n\nBloco ^ideia\n');
  create(root, 'Livro/Nota.md', 'Outra nota.\n');
  create(
    root,
    'Estudos/Outra.md',
    'Veja [[Nota]] e [[Livro/Nota]] e [[Nota#Titulo]] e [[Nota#^ideia]].\n',
  );
  create(
    root,
    'Raiz.md',
    'Ambíguo [[Nota]] e quebrado [[NaoExiste]] e [[Estudos/Nota#Ausente]].\n',
  );
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'foto.png'), 'PNG');
  create(root, 'Estudos/Figura.md', 'Imagem ![[foto.png]] e código:\n\n```\n[[Nota]]\n```\n');

  const fromEstudos = callTool('links.outgoing', {
    libraryPath: root,
    path: 'Estudos/Outra.md',
  }) as Array<{
    raw: string;
    status: string;
    path: string | null;
  }>;
  assert.deepEqual(
    fromEstudos.map((link) => [link.raw, link.status, link.path]),
    [
      ['[[Nota]]', 'resolved', 'Estudos/Nota.md'],
      ['[[Livro/Nota]]', 'resolved', 'Livro/Nota.md'],
      ['[[Nota#Titulo]]', 'resolved', 'Estudos/Nota.md'],
      ['[[Nota#^ideia]]', 'resolved', 'Estudos/Nota.md'],
    ],
  );
  const fromRoot = callTool('links.outgoing', { libraryPath: root, path: 'Raiz.md' }) as Array<{
    raw: string;
    status: string;
    candidates: string[];
  }>;
  assert.equal(fromRoot[0].status, 'ambiguous');
  assert.deepEqual(fromRoot[0].candidates.sort(), ['Estudos/Nota.md', 'Livro/Nota.md']);
  assert.equal(fromRoot[1].status, 'broken');
  assert.equal(fromRoot[2].status, 'broken');
  const figure = callTool('links.outgoing', {
    libraryPath: root,
    path: 'Estudos/Figura.md',
  }) as Array<{
    raw: string;
    format: string;
    status: string;
    path: string | null;
  }>;
  assert.equal(figure.length, 1);
  assert.equal(figure[0].format, 'embed');
  assert.equal(figure[0].path, 'Estudos/foto.png');
  const incoming = callTool('links.backlinks', {
    libraryPath: root,
    path: 'Estudos/Nota.md',
  }) as Array<{
    from: string;
  }>;
  assert.deepEqual(
    incoming.map((link) => link.from),
    ['Estudos/Outra.md', 'Estudos/Outra.md', 'Estudos/Outra.md'],
  );
});

test('mover reescreve links e o undo devolve o texto, sem escapar [[', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', 'Destino.\n');
  create(root, 'Estudos/Outra.md', 'A [[Nota|apelido]] e a [[Nota#Titulo]] e um [[ incompleto.\n');
  callTool('entry.move', {
    libraryPath: root,
    from: 'Estudos/Nota.md',
    to: 'Livro/Movida.md',
    origin: 'agent',
  });
  const disk = fs.readFileSync(path.join(root, 'Estudos', 'Outra.md'), 'utf8');
  assert.match(disk, /\[\[Livro\/Movida\|apelido\]\]/);
  assert.match(disk, /\[\[Livro\/Movida#Titulo\]\]/);
  assert.match(disk, /\[\[ incompleto/);
  assert.equal(disk.includes('\\['), false);
  const history = callTool('history.list', { libraryPath: root }) as Array<{
    tool: string;
    origin: string;
  }>;
  assert.equal(history[0].tool, 'entry.move');
  assert.equal(history[0].origin, 'agent');
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.equal(fs.existsSync(path.join(root, 'Estudos', 'Nota.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'Livro', 'Movida.md')), false);
  assert.match(
    fs.readFileSync(path.join(root, 'Estudos', 'Outra.md'), 'utf8'),
    /\[\[Nota\|apelido\]\]/,
  );
});

test('busca devolve segmentos sem Markdown cru e o grafo filtra estante e tag', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', 'O gato [[Outra|o outro]] dorme.\n', { tags: ['animal'] });
  create(root, 'Estudos/Outra.md', 'Nada aqui.\n');
  create(root, 'Livro/Longe.md', 'Um gato distante.\n', { tags: ['animal'] });
  const hits = callTool('search.query', {
    libraryPath: root,
    query: 'gato',
    workspace: 'Estudos',
  }) as Array<{
    path: string;
    field: string;
    segments: Array<{ text: string; match: boolean }>;
  }>;
  assert.equal(
    hits.some((hit) => hit.path === 'Livro/Longe.md'),
    false,
  );
  const body = hits.find((hit) => hit.path === 'Estudos/Nota.md' && hit.field === 'body');
  assert.ok(body);
  assert.equal(
    body.segments.some((part) => part.match && part.text.toLocaleLowerCase() === 'gato'),
    true,
  );
  assert.equal(
    body.segments
      .map((part) => part.text)
      .join('')
      .includes('[['),
    false,
  );
  const graph = callTool('graph.query', {
    libraryPath: root,
    workspace: 'Estudos',
    tag: 'animal',
  }) as {
    nodes: Array<{ path: string }>;
    edges: Array<{ from: string; to: string }>;
  };
  assert.deepEqual(
    graph.nodes.map((node) => node.path),
    ['Estudos/Nota.md'],
  );
  assert.equal(graph.edges.length, 0);
  const full = callTool('graph.query', { libraryPath: root, workspace: 'Estudos' }) as {
    edges: Array<{ from: string; to: string }>;
  };
  assert.deepEqual(full.edges, [
    { from: 'Estudos/Nota.md', to: 'Estudos/Outra.md', format: 'wiki', weight: 1 },
  ]);
});

test('watcher percebe Markdown gravado fora do motor', async () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', 'Origem.\n');
  callTool('library.watch', { libraryPath: root, enabled: true });
  const before = linkGeneration(root);
  try {
    fs.writeFileSync(path.join(root, 'Estudos', 'Fora.md'), 'Veja [[Nota]].\n');
    const started = Date.now();
    while (linkGeneration(root) === before && Date.now() - started < 2000)
      await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(linkGeneration(root) > before);
    const incoming = callTool('links.backlinks', {
      libraryPath: root,
      path: 'Estudos/Nota.md',
    }) as Array<{
      from: string;
    }>;
    assert.deepEqual(
      incoming.map((link) => link.from),
      ['Estudos/Fora.md'],
    );
  } finally {
    callTool('library.watch', { libraryPath: root, enabled: false });
  }
});
