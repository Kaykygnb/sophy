import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EngineError } from './errors.ts';
import { linkGeneration } from './links.ts';
import { splitMarkdown } from './markdown.ts';
import { collectNoteTags, listNotesForTag, listTagTree, type NoteTag } from './tags.ts';
import { callTool } from './tools.ts';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-tags-'));
  return { root };
}

function create(root: string, file: string, body: string, frontmatter?: Record<string, unknown>) {
  return callTool('note.create', {
    libraryPath: root,
    path: file,
    body,
    frontmatter,
    origin: 'ui',
  }) as { path: string; body: string; frontmatter: Record<string, unknown> | null };
}

function names(frontmatter: Record<string, unknown> | null, body: string) {
  return collectNoteTags(frontmatter, body).map((tag) => tag.name);
}

test('reconhece tag no texto e ignora código, link, URL, HTML e título', () => {
  const body = [
    '#ação no começo',
    'espaço #projeto/sophy e (#beta) [#gama] "#delta"',
    'fim.#nao e fim, #sim e letra#nao',
    '#123 #123a #a123 #12-3 #--- #123/456 #123/a #projeto/',
    '# Título',
    '## Título',
    '    #indentada',
    '[[Nota#seção]] [[#seção]] ![[Figura#corte]]',
    '[#tag](https://ex.com/a#frag) e https://ex.com/b#frag',
    '<span data-cor="#azul"> #visivel</span>',
    '`#codigo`',
    '```',
    '#cerca',
    '```',
    '~~~',
    '#til',
    '~~~',
    '\\#escapada',
    '',
  ].join('\n');
  assert.deepEqual(names(null, body), [
    'ação',
    'projeto/sophy',
    'beta',
    'gama',
    'delta',
    'sim',
    '123a',
    'a123',
    '12-3',
    '---',
    '123/a',
    'projeto',
    'indentada',
    'visivel',
  ]);
});

test('frontmatter aceita lista, lista inline e string, com # inicial', () => {
  const listed = names({ tags: ['#Ação', 'projeto/sophy', '123', 'Ação'] }, '');
  assert.deepEqual(listed, ['Ação', 'projeto/sophy']);
  assert.deepEqual(
    collectNoteTags({ tags: ['#Ação', 'projeto/sophy'] }, '').map((tag) => tag.key),
    ['ação', 'projeto/sophy'],
  );
  assert.deepEqual(names({ tags: '#alfa #beta, gama' }, ''), ['alfa', 'beta', 'gama']);
  assert.deepEqual(names({ tags: 'alfa beta' }, ''), ['alfa', 'beta']);
  assert.deepEqual(names({ tags: 'alfa, beta' }, ''), ['alfa', 'beta']);
  const both = collectNoteTags({ tags: ['Sophy'] }, 'texto #sophy #Outra');
  assert.deepEqual(
    both.map((tag) => [tag.name, tag.source]),
    [
      ['Sophy', 'both'],
      ['Outra', 'text'],
    ],
  );
  assert.deepEqual(names({ title: 'veja #nao', tags: ['sim'] }, ''), ['sim']);
});

test('caminho com barra invertida vira barra normal na lista de notas', () => {
  const records = [
    {
      path: 'Estudos\\Nota.md',
      title: 'Nota',
      mtime: 5,
      tagRecords: [{ key: 'ação', name: 'Ação', source: 'text' } satisfies NoteTag],
    },
  ];
  const found = listNotesForTag(records, '#AÇÃO', false);
  assert.deepEqual(found.notes, [
    { path: 'Estudos/Nota.md', title: 'Nota', mtime: 5, source: 'text' },
  ]);
});

test('tag aninhada abre os pais na árvore com count zero', () => {
  const tree = listTagTree([
    {
      path: 'N.md',
      title: 'N',
      mtime: 1,
      tagRecords: [{ key: 'a/b/c', name: 'A/B/C', source: 'text' }],
    },
  ]);
  assert.equal(tree.tags[0].count, 0);
  assert.equal(tree.tags[0].total, 1);
  assert.equal(tree.tags[0].children[0].count, 0);
  assert.equal(tree.tags[0].children[0].path, 'A/B');
  assert.equal(tree.tags[0].children[0].children[0].count, 1);
  assert.equal(tree.tags[0].children[0].children[0].path, 'A/B/C');
});

test('árvore, notas, busca, sugestão e grafo seguem o contrato', () => {
  const { root } = fixture();
  create(root, 'Estudos/A.md', '# Título\n\n#alfa e #projeto/sophy\n', { tags: ['projeto'] });
  create(root, 'Estudos/B.md', 'Um gato #projeto/engine.\n');
  create(root, 'Livro/C.md', 'Um gato sem a tag.\n', { tags: ['beta'] });
  create(root, 'Estudos/D.md', 'Liga [[B]] e [[C]].\n#projeto #beta\n');

  const tree = callTool('tags.list', { libraryPath: root }) as {
    tags: Array<{ name: string; path: string; count: number; total: number; children: Array<{ name: string; path: string; count: number; total: number }> }>;
  };
  const projeto = tree.tags.find((tag) => tag.path === 'projeto');
  assert.ok(projeto);
  assert.equal(projeto.count, 2);
  assert.equal(projeto.total, 3);
  assert.deepEqual(
    projeto.children.map((child) => [child.name, child.path, child.count, child.total]),
    [
      ['engine', 'projeto/engine', 1, 1],
      ['sophy', 'projeto/sophy', 1, 1],
    ],
  );
  assert.deepEqual(
    tree.tags.map((tag) => tag.name),
    ['projeto', 'beta', 'alfa'],
  );
  assert.equal(tree.tags[0].total >= tree.tags[1].total, true);

  const nested = callTool('tags.notes', { libraryPath: root, tag: '#Projeto' }) as {
    notes: Array<{ path: string; title: string; mtime: number; source: string }>;
  };
  assert.deepEqual(
    nested.notes.map((note) => [note.path, note.source]),
    [
      ['Estudos/A.md', 'both'],
      ['Estudos/B.md', 'text'],
      ['Estudos/D.md', 'text'],
    ],
  );
  assert.equal(typeof nested.notes[0].mtime, 'number');
  assert.equal(nested.notes[0].title, 'Título');
  const exact = callTool('tags.notes', { libraryPath: root, tag: 'projeto', nested: false }) as {
    notes: Array<{ path: string }>;
  };
  assert.deepEqual(
    exact.notes.map((note) => note.path),
    ['Estudos/A.md', 'Estudos/D.md'],
  );

  const any = callTool('search.query', {
    libraryPath: root,
    query: 'gato',
    tag: 'projeto',
  }) as Array<{ path: string }>;
  assert.deepEqual(
    any.map((hit) => hit.path),
    ['Estudos/B.md'],
  );
  const all = callTool('search.query', {
    libraryPath: root,
    query: 'gato',
    tags: ['projeto', 'beta'],
    tagsMode: 'all',
  }) as unknown[];
  assert.equal(all.length, 0);
  const some = callTool('search.query', {
    libraryPath: root,
    query: 'gato',
    tags: ['beta', 'ausente'],
    workspace: 'Livro',
  }) as Array<{ path: string }>;
  assert.deepEqual(
    some.map((hit) => hit.path),
    ['Livro/C.md'],
  );

  const suggested = callTool('tag.suggest', { libraryPath: root, prefix: '#Pro', limit: 2 }) as {
    tags: Array<{ name: string; total: number }>;
  };
  assert.deepEqual(suggested.tags, [
    { name: 'projeto', total: 3 },
    { name: 'projeto/engine', total: 1 },
  ]);

  const graph = callTool('graph.query', { libraryPath: root, tag: 'projeto' }) as {
    nodes: Array<{ path: string; tags: string[] }>;
    edges: Array<{ from: string; to: string }>;
  };
  assert.deepEqual(
    graph.nodes.map((node) => node.path).sort(),
    ['Estudos/A.md', 'Estudos/B.md', 'Estudos/D.md'],
  );
  assert.deepEqual(graph.nodes.find((node) => node.path === 'Estudos/A.md')?.tags, [
    'projeto',
    'alfa',
    'projeto/sophy',
  ]);
  assert.equal(
    graph.edges.some((edge) => edge.to === 'Livro/C.md'),
    false,
  );
  assert.deepEqual(
    graph.edges.filter((edge) => edge.from === 'Estudos/D.md').map((edge) => edge.to),
    ['Estudos/B.md'],
  );
  const both = callTool('graph.query', {
    libraryPath: root,
    tags: ['projeto', 'beta'],
    tagsMode: 'all',
  }) as { nodes: Array<{ path: string }>; edges: unknown[] };
  assert.deepEqual(
    both.nodes.map((node) => node.path),
    ['Estudos/D.md'],
  );
  assert.equal(both.edges.length, 0);
});

test('renomear reescreve texto e frontmatter, une destino e desfaz tudo de uma vez', () => {
  const { root } = fixture();
  create(root, 'Estudos/A.md', 'Veja #Projeto/Sophy e #projeto.\n\n```\n#projeto\n```\n\n`#projeto`\n[[Nota#projeto]]\n<span data-cor="#projeto"> #projeto</span>\n', {
    title: 'Origem',
    tags: ['projeto', 'novo'],
    notas1_editor: { icon: 'leaf' },
  });
  create(root, 'Estudos/B.md', 'Só #outro.\n');
  create(root, 'Livro/C.md', 'Filha #projeto/sophy/extra.\n', { tags: ['projeto/sophy'] });
  const untouched = fs.readFileSync(path.join(root, 'Estudos', 'B.md'), 'utf8');
  const before = callTool('history.list', { libraryPath: root }) as unknown[];
  const renamed = callTool('tag.rename', {
    libraryPath: root,
    from: '#projeto',
    to: 'novo',
    origin: 'ui',
  }) as { changedNotes: number; replaced: number };
  assert.deepEqual(renamed, { changedNotes: 2, replaced: 6 });
  const fileA = fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8');
  const partsA = splitMarkdown(fileA);
  assert.deepEqual(partsA.frontmatter?.tags, ['novo']);
  assert.equal(partsA.frontmatter?.title, 'Origem');
  assert.deepEqual(partsA.frontmatter?.notas1_editor, { icon: 'leaf' });
  assert.equal(typeof partsA.frontmatter?.id, 'string');
  assert.match(partsA.body, /#novo\/Sophy/);
  assert.match(partsA.body, /```\n#projeto\n```/);
  assert.match(partsA.body, /`#projeto`/);
  assert.match(partsA.body, /\[\[Nota#projeto\]\]/);
  assert.match(partsA.body, /data-cor="#projeto"/);
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'B.md'), 'utf8'), untouched);
  const partsC = splitMarkdown(fs.readFileSync(path.join(root, 'Livro', 'C.md'), 'utf8'));
  assert.deepEqual(partsC.frontmatter?.tags, ['novo/sophy']);
  assert.match(partsC.body, /#novo\/sophy\/extra/);
  const history = callTool('history.list', { libraryPath: root }) as Array<{ tool: string }>;
  assert.equal(history.length, before.length + 1);
  assert.equal(history[0].tool, 'tag.rename');
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8'), /#Projeto\/Sophy/);
  assert.match(fs.readFileSync(path.join(root, 'Livro', 'C.md'), 'utf8'), /#projeto\/sophy\/extra/);
  const same = callTool('tag.rename', {
    libraryPath: root,
    from: 'projeto',
    to: 'projeto',
    origin: 'ui',
  }) as { changedNotes: number; replaced: number };
  assert.deepEqual(same, { changedNotes: 0, replaced: 0 });
  assert.equal((callTool('history.list', { libraryPath: root }) as unknown[]).length, before.length);
});

test('tag inválida e tag inexistente têm códigos estáveis', () => {
  const { root } = fixture();
  create(root, 'Estudos/A.md', 'Nada #real.\n');
  assert.throws(
    () => callTool('tag.rename', { libraryPath: root, from: '123', to: 'nova', origin: 'ui' }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_invalida',
  );
  assert.throws(
    () => callTool('tag.rename', { libraryPath: root, from: 'real', to: '#123', origin: 'ui' }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_invalida',
  );
  assert.throws(
    () => callTool('tag.rename', { libraryPath: root, from: 'ausente', to: 'nova', origin: 'ui' }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_inexistente',
  );
  assert.throws(
    () => callTool('tags.notes', { libraryPath: root, tag: '123' }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_invalida',
  );
  const missing = callTool('tags.notes', { libraryPath: root, tag: 'ausente' }) as { notes: unknown[] };
  assert.deepEqual(missing.notes, []);
  const codeOnly = callTool('tag.rename', {
    libraryPath: root,
    from: 'real',
    to: 'outra',
    origin: 'ui',
  }) as { changedNotes: number };
  assert.equal(codeOnly.changedNotes, 1);
  create(root, 'Estudos/Cerca.md', '```\n#so-na-cerca\n```\n~~~md\n#tambem\n~~~\n');
  assert.throws(
    () => callTool('tag.rename', { libraryPath: root, from: 'so-na-cerca', to: 'x', origin: 'ui' }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_inexistente',
  );
});

test('note.tags mexe só no frontmatter e um desfazer volta a nota', () => {
  const { root } = fixture();
  const created = create(root, 'Estudos/Chips.md', 'corpo #texto\n', { title: 'Chips', tags: 'a b' });
  const id = created.frontmatter?.id;
  const read = callTool('note.tags', {
    libraryPath: root,
    path: 'Estudos/Chips.md',
    origin: 'ui',
  }) as { tags: string[] };
  assert.deepEqual(read.tags, ['a', 'b']);
  const before = (callTool('history.list', { libraryPath: root }) as unknown[]).length;
  assert.equal((callTool('history.list', { libraryPath: root }) as unknown[]).length, before);
  const added = callTool('note.tags', {
    libraryPath: root,
    path: 'Estudos/Chips.md',
    add: ['#C', 'a', 'projeto/sophy'],
    remove: ['b'],
    origin: 'ui',
  }) as { tags: string[] };
  assert.deepEqual(added.tags, ['a', 'C', 'projeto/sophy']);
  const disk = splitMarkdown(fs.readFileSync(path.join(root, 'Estudos', 'Chips.md'), 'utf8'));
  assert.equal(disk.body, 'corpo #texto\n');
  assert.equal(disk.frontmatter?.title, 'Chips');
  assert.equal(disk.frontmatter?.id, id);
  assert.deepEqual(disk.frontmatter?.tags, ['a', 'C', 'projeto/sophy']);
  const history = callTool('history.list', { libraryPath: root }) as Array<{ tool: string }>;
  assert.equal(history[0].tool, 'note.tags');
  const removed = callTool('note.tags', {
    libraryPath: root,
    path: 'Estudos/Chips.md',
    remove: ['a', 'C', 'projeto/sophy'],
    origin: 'ui',
  }) as { tags: string[] };
  assert.deepEqual(removed.tags, []);
  const cleared = splitMarkdown(fs.readFileSync(path.join(root, 'Estudos', 'Chips.md'), 'utf8'));
  assert.equal(cleared.frontmatter?.tags, undefined);
  assert.equal(cleared.frontmatter?.title, 'Chips');
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  const restored = splitMarkdown(fs.readFileSync(path.join(root, 'Estudos', 'Chips.md'), 'utf8'));
  assert.deepEqual(restored.frontmatter?.tags, ['a', 'C', 'projeto/sophy']);
  assert.throws(
    () =>
      callTool('note.tags', {
        libraryPath: root,
        path: 'Estudos/Chips.md',
        add: ['123'],
        origin: 'ui',
      }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_invalida',
  );
  const indexed = callTool('graph.query', { libraryPath: root }) as {
    nodes: Array<{ path: string; tags: string[] }>;
  };
  assert.deepEqual(indexed.nodes.find((node) => node.path === 'Estudos/Chips.md')?.tags, [
    'a',
    'C',
    'projeto/sophy',
    'texto',
  ]);
});

test('pai sem nota própria entra na árvore e a renomeação alcança o filho', () => {
  const { root } = fixture();
  create(root, 'Estudos/Filha.md', '#Projeto/Sophy\n');
  const tree = callTool('tags.list', { libraryPath: root }) as {
    tags: Array<{ name: string; path: string; count: number; total: number; children: Array<{ name: string; path: string }> }>;
  };
  assert.deepEqual(tree.tags, [
    {
      name: 'Projeto',
      path: 'Projeto',
      count: 0,
      total: 1,
      children: [{ name: 'Sophy', path: 'Projeto/Sophy', count: 1, total: 1, children: [] }],
    },
  ]);
  const renamed = callTool('tag.rename', {
    libraryPath: root,
    from: 'projeto',
    to: 'novo',
    origin: 'ui',
  }) as { changedNotes: number; replaced: number };
  assert.deepEqual(renamed, { changedNotes: 1, replaced: 1 });
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Filha.md'), 'utf8'), /#novo\/Sophy/);
  const again = callTool('tags.list', { libraryPath: root }) as {
    tags: Array<{ path: string; count: number; total: number }>;
  };
  assert.equal(again.tags.some((tag) => tag.path === 'Projeto'), false);
  assert.equal(again.tags[0].path, 'novo');
  assert.equal(again.tags[0].count, 0);
  assert.equal(again.tags[0].total, 1);
});

test('o vigia atualiza o índice da nota alterada', async () => {
  const { root } = fixture();
  create(root, 'Estudos/Fixa.md', 'Nota #fixa.\n');
  create(root, 'Estudos/Nota.md', 'Sem tag.\n');
  callTool('library.watch', { libraryPath: root, enabled: true });
  const before = linkGeneration(root);
  try {
    fs.writeFileSync(path.join(root, 'Estudos', 'Nota.md'), 'Agora #vigia.\n');
    const started = Date.now();
    while (linkGeneration(root) === before && Date.now() - started < 2000)
      await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(linkGeneration(root) > before);
    const listed = callTool('tags.list', { libraryPath: root }) as {
      tags: Array<{ name: string }>;
    };
    assert.deepEqual(
      listed.tags.map((tag) => tag.name).sort(),
      ['fixa', 'vigia'],
    );
  } finally {
    callTool('library.watch', { libraryPath: root, enabled: false });
  }
});
