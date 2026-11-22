import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { namedBlocksOf } from './blocks.ts';
import { EngineError } from './errors.ts';
import { headingsOf, sectionsOf } from './wikilinks.ts';
import { callTool } from './tools.ts';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-blocos-'));
  return { root };
}

function create(root: string, file: string, body: string) {
  return callTool('note.create', {
    libraryPath: root,
    path: file,
    body,
    origin: 'ui',
  }) as { path: string; body: string };
}

test('title="..." vale em qualquer posição e a linguagem é a primeira palavra', () => {
  const source = [
    '```js title="api"',
    'const a = 1;',
    '```',
    '',
    '```title="dados" python',
    'print(1)',
    '```',
    '',
    '~~~md title="onda"~~~',
    'texto',
    '~~~',
    '',
    "```js title='aspas simples'",
    'nao',
    '```',
    '',
    '````js',
    '```js title="falso"',
    'ainda',
    '````',
  ].join('\n');
  const blocks = namedBlocksOf(source);
  assert.deepEqual(
    blocks.map((block) => [block.title, block.lang, block.startLine, block.endLine]),
    [
      ['api', 'js', 1, 3],
      ['dados', 'python', 5, 7],
      ['onda', 'md', 9, 11],
    ],
  );
  assert.equal(blocks.some((block) => block.title === 'falso' || block.title === 'aspas simples'), false);
});

test('# dentro da cerca não vira seção e o bloco nomeado continua visível', () => {
  const source = ['# Real', '', '```js title="demo"', '# Falso', 'const x = 1;', '```', ''].join('\n');
  assert.deepEqual(headingsOf(source), ['Real']);
  assert.deepEqual(sectionsOf(source).map((section) => section.title), ['Real']);
  assert.equal(namedBlocksOf(source)[0].title, 'demo');
});

test('dois blocos com o mesmo slug: o primeiro resolve e o outro fica duplicate', () => {
  const { root } = fixture();
  create(
    root,
    'Estudos/Nota.md',
    ['# Outra', '', '```js title="Ação"', 'um', '```', '', '```py title="acao"', 'dois', '```', ''].join('\n'),
  );
  create(root, 'Estudos/Fonte.md', 'Veja [[Nota#acao]].\n');
  const scanned = callTool('links.scan', { libraryPath: root, path: 'Estudos/Nota.md' }) as {
    blocks: Array<{ title: string; duplicate?: true; startLine: number }>;
  };
  assert.equal(scanned.blocks[0].title, 'Ação');
  assert.equal(scanned.blocks[0].duplicate, undefined);
  assert.equal(scanned.blocks[1].duplicate, true);
  const resolved = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: 'Nota#acao',
  }) as { kind: string; title: string; preview: string; startLine: number };
  assert.equal(resolved.kind, 'block');
  assert.equal(resolved.title, 'Ação');
  assert.equal(resolved.preview, 'um');
  assert.equal(resolved.startLine, scanned.blocks[0].startLine);
});

test('seção ganha da colisão e o alvo inexistente mantém o erro atual', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', ['# Api', '', '```js title="api"', 'codigo', '```', ''].join('\n'));
  create(root, 'Alpha/Nota.md', 'Outra.\n');
  create(root, 'Raiz.md', 'Ambíguo [[Nota]].\n');
  create(root, 'Estudos/Fonte.md', '[[Nota#api]] e [[Nota#ausente]] e [[NaoExiste#api]] e [[/tmp/A#x]].\n');
  const section = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: '[[Nota#api]]',
  }) as { kind: string; title: string; path: string };
  assert.equal(section.kind, 'section');
  assert.equal(section.title, 'Api');
  assert.equal(section.path, 'Estudos/Nota.md');
  const missingAnchor = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: 'Nota#ausente',
  }) as { path: string | null; invalid: boolean; kind?: string };
  assert.equal(missingAnchor.path, null);
  assert.equal(missingAnchor.invalid, false);
  assert.equal(missingAnchor.kind, undefined);
  const missingNote = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: 'NaoExiste#api',
  }) as { path: string | null; invalid: boolean; kind?: string };
  assert.equal(missingNote.path, null);
  assert.equal(missingNote.invalid, false);
  assert.equal(missingNote.kind, undefined);
  const invalid = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: '/tmp/A#x',
  }) as { invalid: boolean; kind?: string };
  assert.equal(invalid.invalid, true);
  assert.equal(invalid.kind, undefined);
  const ambiguous = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: 'Nota',
  }) as { path: string | null; candidates: string[]; kind?: string };
  assert.equal(ambiguous.path, 'Estudos/Nota.md');
  const fromOutside = callTool('links.resolve', {
    libraryPath: root,
    path: 'Raiz.md',
    target: 'Nota',
  }) as { path: string | null; candidates: string[]; kind?: string };
  assert.equal(fromOutside.path, null);
  assert.equal(fromOutside.kind, undefined);
  assert.equal(fromOutside.candidates.length, 2);
});

test('prévia do bloco devolve lang, title e code; a seção devolve o trecho', () => {
  const { root } = fixture();
  create(
    root,
    'Estudos/Nota.md',
    ['# Api', 'texto da seção', '', '```js title="api"', 'linha 1', 'linha 2', '```', ''].join('\n'),
  );
  const block = callTool('links.preview', {
    libraryPath: root,
    path: 'Estudos/Nota.md',
    target: 'Nota#api',
  }) as { kind: string; lang?: string; title: string; code?: string; text?: string };
  assert.equal(block.kind, 'section');
  assert.match(block.text || '', /# Api/);
  assert.match(block.text || '', /texto da seção/);
  assert.equal(block.code, undefined);
  const onlyBlock = callTool('links.preview', {
    libraryPath: root,
    path: 'Estudos/Nota.md',
    target: '[[Nota#api]]',
  });
  assert.equal((onlyBlock as { kind: string }).kind, 'section');
  create(root, 'Estudos/Codigo.md', ['```py title="rotina"', 'return 1', '```', ''].join('\n'));
  const code = callTool('links.preview', {
    libraryPath: root,
    path: 'Estudos/Codigo.md',
    target: 'Codigo#rotina',
  }) as { kind: string; lang: string; title: string; code: string };
  assert.deepEqual(code, { kind: 'block', lang: 'py', title: 'rotina', code: 'return 1' });
});

test('resolve corta a prévia em 40 linhas e marca truncated', () => {
  const { root } = fixture();
  const lines = Array.from({ length: 41 }, (_, index) => `linha ${index + 1}`);
  create(root, 'Estudos/Longa.md', ['```js title="longa"', ...lines, '```', ''].join('\n'));
  const resolved = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Longa.md',
    target: 'Longa#longa',
  }) as { kind: string; preview: string; truncated: boolean; lang: string; title: string };
  assert.equal(resolved.kind, 'block');
  assert.equal(resolved.lang, 'js');
  assert.equal(resolved.title, 'longa');
  assert.equal(resolved.truncated, true);
  assert.equal(resolved.preview.split('\n').length, 40);
  assert.match(resolved.preview, /^linha 1\n/);
  assert.equal(resolved.preview.includes('linha 41'), false);
  const full = callTool('links.preview', {
    libraryPath: root,
    path: 'Estudos/Longa.md',
    target: 'Longa#longa',
  }) as { code: string };
  assert.equal(full.code.split('\n').length, 41);
});

test('block.rename reescreve a cerca e os links, num único desfazer', () => {
  const { root } = fixture();
  callTool('note.create', {
    libraryPath: root,
    path: 'Estudos/Nota.md',
    body: [
      '```js title="api"',
      'const a = 1;',
      '```',
      '',
      'Aqui [[#api|local]] e no código:',
      '',
      '```',
      '[[#api]]',
      '```',
      '',
    ].join('\n'),
    frontmatter: { ref: '[[#api]]' },
    origin: 'ui',
  });
  create(root, 'Estudos/Fonte.md', 'Veja [[Nota#api|apelido]], [[Estudos/Nota#API]] e ![[Nota#api]].\n');
  create(root, 'Livro/Outra.md', 'Não mexe [[Outra#api]] nem [[Nota]].\n');
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Quadro.canvas'),
    JSON.stringify({
      nodes: [{ id: '1', type: 'text', text: 'Canvas [[Nota#api]]', x: 0, y: 0, width: 100, height: 40 }],
      edges: [],
    }),
  );
  const before = fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8');
  const result = callTool('block.rename', {
    libraryPath: root,
    notePath: 'Estudos\\Nota.md',
    de: 'API',
    para: 'codigo',
    origin: 'ui',
  }) as { updated: string[]; title: string };
  assert.equal(result.title, 'codigo');
  assert.ok(result.updated.includes('Estudos/Nota.md'));
  assert.ok(result.updated.includes('Estudos/Fonte.md'));
  const note = fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8');
  assert.match(note, /title="codigo"/);
  assert.match(note, /\[\[#codigo\|local\]\]/);
  assert.match(note, /```\n\[\[#api\]\]\n```/);
  assert.match(note, /ref: "\[\[#api\]\]"/);
  const fonte = fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8');
  assert.match(fonte, /\[\[Nota#codigo\|apelido\]\]/);
  assert.match(fonte, /\[\[Estudos\/Nota#codigo\]\]/);
  assert.match(fonte, /!\[\[Nota#codigo\]\]/);
  assert.match(fs.readFileSync(path.join(root, 'Livro', 'Outra.md'), 'utf8'), /\[\[Outra#api\]\]/);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Quadro.canvas'), 'utf8'), /\[\[Nota#codigo\]\]/);
  const history = callTool('history.list', { libraryPath: root }) as Array<{ tool: string }>;
  assert.equal(history[0].tool, 'block.rename');
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8'), before);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /\[\[Nota#api\|apelido\]\]/);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Quadro.canvas'), 'utf8'), /\[\[Nota#api\]\]/);
});

test('block.rename devolve versionId e agent.undo desfaz todos os arquivos', () => {
  const { root } = fixture();
  create(
    root,
    'Estudos/Nota.md',
    ['# Outro', '', '```js title="api"', 'const a = 1;', '```', '', '[[#api|local]]', ''].join('\n'),
  );
  create(root, 'Estudos/Fonte.md', 'Veja [[Nota#api|apelido]] e [[Estudos/Nota#API]].\n');
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Quadro.canvas'),
    JSON.stringify({
      nodes: [{ id: '1', type: 'text', text: 'Canvas [[Nota#api]]', x: 0, y: 0, width: 100, height: 40 }],
      edges: [],
    }),
  );
  const notePath = path.join(root, 'Estudos', 'Nota.md');
  const fontePath = path.join(root, 'Estudos', 'Fonte.md');
  const canvasPath = path.join(root, 'Estudos', 'Quadro.canvas');
  const before = {
    note: fs.readFileSync(notePath, 'utf8'),
    fonte: fs.readFileSync(fontePath, 'utf8'),
    canvas: fs.readFileSync(canvasPath, 'utf8'),
  };
  assert.throws(
    () =>
      callTool('block.rename', {
        libraryPath: root,
        notePath: 'Estudos/Nota.md',
        de: 'api',
        para: 'Outro',
        origin: 'ui',
      }),
    (error: unknown) => error instanceof EngineError && error.code === 'nome_em_uso',
  );
  assert.equal(fs.readFileSync(notePath, 'utf8'), before.note);
  assert.equal(fs.readFileSync(fontePath, 'utf8'), before.fonte);
  const result = callTool('block.rename', {
    libraryPath: root,
    notePath: 'Estudos/Nota.md',
    de: 'api',
    para: 'codigo',
    origin: 'ui',
  }) as {
    path: string;
    title: string;
    from: string;
    updated: string[];
    shadowed: boolean;
    versionId: string;
  };
  assert.equal(result.path, 'Estudos/Nota.md');
  assert.equal(result.title, 'codigo');
  assert.equal(result.from, 'api');
  assert.equal(result.shadowed, false);
  assert.ok(result.updated.includes('Estudos/Nota.md'));
  assert.ok(result.updated.includes('Estudos/Fonte.md'));
  assert.ok(result.updated.includes('Estudos/Quadro.canvas'));
  assert.equal(typeof result.versionId, 'string');
  assert.ok(result.versionId);
  assert.match(fs.readFileSync(notePath, 'utf8'), /title="codigo"/);
  assert.match(fs.readFileSync(fontePath, 'utf8'), /\[\[Nota#codigo\|apelido\]\]/);
  assert.match(fs.readFileSync(canvasPath, 'utf8'), /\[\[Nota#codigo\]\]/);
  create(root, 'Estudos/Depois.md', 'fica\n');
  const history = callTool('history.list', { libraryPath: root }) as Array<{ id: string; tool: string }>;
  assert.equal(history.find((item) => item.tool === 'block.rename')?.id, result.versionId);
  const undone = callTool('agent.undo', { libraryPath: root, versionId: result.versionId }) as {
    undone: string;
    tool: string;
  };
  assert.equal(undone.undone, result.versionId);
  assert.equal(undone.tool, 'block.rename');
  assert.equal(fs.readFileSync(notePath, 'utf8'), before.note);
  assert.equal(fs.readFileSync(fontePath, 'utf8'), before.fonte);
  assert.equal(fs.readFileSync(canvasPath, 'utf8'), before.canvas);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Depois.md'), 'utf8'), /fica/);
});

test('nome_em_uso não altera a nota nem os links', () => {
  const { root } = fixture();
  create(
    root,
    'Estudos/Nota.md',
    ['# Pronto', '', '```js title="api"', 'a', '```', '', '```js title="outro"', 'b', '```', ''].join('\n'),
  );
  create(root, 'Estudos/Fonte.md', '[[Nota#api]]\n');
  const noteBefore = fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8');
  const fonteBefore = fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8');
  assert.throws(
    () =>
      callTool('block.rename', {
        libraryPath: root,
        notePath: 'Estudos/Nota.md',
        de: 'api',
        para: 'Pronto',
        origin: 'ui',
      }),
    (error: unknown) => error instanceof EngineError && error.code === 'nome_em_uso',
  );
  assert.throws(
    () =>
      callTool('block.rename', {
        libraryPath: root,
        notePath: 'Estudos/Nota.md',
        de: 'api',
        para: 'outro',
        origin: 'ui',
      }),
    (error: unknown) => error instanceof EngineError && error.code === 'nome_em_uso',
  );
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8'), noteBefore);
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), fonteBefore);
  const history = callTool('history.list', { libraryPath: root }) as Array<{ tool: string }>;
  assert.equal(history.some((item) => item.tool === 'block.rename'), false);
});

test('renomear um bloco encoberto pela seção não reescreve o link da seção', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', ['# Api', '', '```js title="api"', 'codigo', '```', ''].join('\n'));
  create(root, 'Estudos/Fonte.md', '[[Nota#api]]\n');
  callTool('block.rename', {
    libraryPath: root,
    notePath: 'Estudos/Nota.md',
    de: 'api',
    para: 'rotina',
    origin: 'ui',
  });
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8'), /title="rotina"/);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /\[\[Nota#api\]\]/);
  const resolved = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: 'Nota#api',
  }) as { kind: string; title: string };
  assert.equal(resolved.kind, 'section');
  assert.equal(resolved.title, 'Api');
});

test('mover a nota continua atualizando [[Nota#nome]]', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', '```js title="api"\nconst a = 1;\n```\n');
  create(root, 'Estudos/Fonte.md', '[[Nota#api|apelido]]\n');
  callTool('entry.move', {
    libraryPath: root,
    from: 'Estudos/Nota.md',
    to: 'Livro/Movida.md',
    origin: 'ui',
  });
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /\[\[Livro\/Movida#api\|apelido\]\]/);
  const resolved = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: 'Livro/Movida#api',
  }) as { kind: string; notePath: string; preview: string };
  assert.equal(resolved.kind, 'block');
  assert.equal(resolved.notePath, 'Livro/Movida.md');
  assert.equal(resolved.preview, 'const a = 1;');
});

test('grafo não ganha nó e a aresta nota→nota pode levar o alvo', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', '```js title="api"\n1\n```\n\n# Secao\n');
  create(root, 'Estudos/Fonte.md', '[[Nota#api]] e [[Nota#Secao]] e [[Nota]].\n');
  const graph = callTool('graph.query', { libraryPath: root, workspace: 'Estudos' }) as {
    nodes: Array<{ path: string }>;
    edges: Array<{ from: string; to: string; format: string; target?: { kind: string; anchor: string } }>;
  };
  assert.deepEqual(
    graph.nodes.map((node) => node.path).sort(),
    ['Estudos/Fonte.md', 'Estudos/Nota.md'],
  );
  const edges = graph.edges.filter((edge) => edge.from === 'Estudos/Fonte.md');
  assert.equal(edges.length, 3);
  assert.deepEqual(
    edges.find((edge) => edge.target?.anchor === 'api')?.target,
    { kind: 'block', anchor: 'api' },
  );
  assert.deepEqual(
    edges.find((edge) => edge.target?.anchor === 'Secao')?.target,
    { kind: 'section', anchor: 'Secao' },
  );
  const plain = edges.find((edge) => !edge.target);
  assert.deepEqual(plain, { from: 'Estudos/Fonte.md', to: 'Estudos/Nota.md', format: 'wiki' });
});

test('caminho com barra invertida resolve o bloco e o catálogo lista blocks', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', '```js title="api"\nvalor\n```\n');
  create(root, 'Estudos/Fonte.md', '[[Estudos\\Nota#api]]\n');
  const outgoing = callTool('links.outgoing', { libraryPath: root, path: 'Estudos/Fonte.md' }) as Array<{
    status: string;
    kind?: string;
    path: string | null;
  }>;
  assert.equal(outgoing[0].status, 'resolved');
  assert.equal(outgoing[0].kind, 'block');
  assert.equal(outgoing[0].path, 'Estudos/Nota.md');
  const catalog = callTool('links.catalog', { libraryPath: root }) as Array<{
    path: string;
    blocks: Array<{ title: string; lang: string }>;
  }>;
  const note = catalog.find((item) => item.path === 'Estudos/Nota.md');
  assert.deepEqual(note?.blocks.map((block) => [block.title, block.lang]), [['api', 'js']]);
  const scanned = callTool('links.scan', { libraryPath: root, path: 'Estudos\\Nota.md' }) as {
    path: string;
    blocks: Array<{ title: string }>;
  };
  assert.equal(scanned.path, 'Estudos/Nota.md');
  assert.equal(scanned.blocks[0].title, 'api');
});
