import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EngineError } from './errors.ts';
import { EDITOR_TAG_COLORS } from './tag-colors.ts';
import { relatedTags, type NoteTag } from './tags.ts';
import { callTool, toolMutates } from './tools.ts';

const PALETTE = ['cinza', 'marrom', 'laranja', 'amarelo', 'verde', 'azul', 'roxo', 'rosa', 'vermelho'];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-tag-cor-'));
  return { root };
}

function create(root: string, file: string, body: string, frontmatter?: Record<string, unknown>) {
  return callTool('note.create', {
    libraryPath: root,
    path: file,
    body,
    frontmatter,
    origin: 'ui',
  });
}

function colorFile(root: string) {
  return path.join(root, '.sophy', 'tags.json');
}

function readColors(root: string) {
  return JSON.parse(fs.readFileSync(colorFile(root), 'utf8')) as { cores: Record<string, string> };
}

test('a paleta da cor é a do editor', () => {
  assert.deepEqual(EDITOR_TAG_COLORS, PALETTE);
});

test('tag.color.get e set gravam em .sophy/tags.json e normalizam tag e cor', () => {
  const { root } = fixture();
  assert.deepEqual(callTool('tag.color.get', { libraryPath: root }), {});
  assert.equal(fs.existsSync(colorFile(root)), false);
  assert.deepEqual(
    callTool('tag.color.set', { libraryPath: root, tag: 'vazia', cor: '', origin: 'ui' }),
    { tag: 'vazia', cor: null },
  );
  assert.equal(fs.existsSync(colorFile(root)), false);

  for (const name of PALETTE) {
    const saved = callTool('tag.color.set', {
      libraryPath: root,
      tag: `#${name.toUpperCase()}`,
      cor: name[0].toUpperCase() + name.slice(1),
      origin: 'ui',
    }) as { tag: string; cor: string };
    assert.deepEqual(saved, { tag: name, cor: name });
  }
  const hex = callTool('tag.color.set', {
    libraryPath: root,
    tag: ' #Ação/ ',
    cor: '  #C45B45 ',
    origin: 'ui',
  }) as { tag: string; cor: string };
  assert.deepEqual(hex, { tag: 'ação', cor: '#c45b45' });
  const again = callTool('tag.color.set', {
    libraryPath: root,
    tag: 'AÇÃO',
    cor: 'azul',
    origin: 'ui',
  }) as { tag: string; cor: string };
  assert.deepEqual(again, { tag: 'ação', cor: 'azul' });

  const colors = callTool('tag.color.get', { libraryPath: root }) as Record<string, string>;
  assert.equal(colors.ação, 'azul');
  assert.equal(colors.azul, 'azul');
  assert.equal(colors.vermelho, 'vermelho');
  assert.equal(readColors(root).cores.ação, 'azul');
  assert.equal(readColors(root).cores.projeto, undefined);
  const stored = fs.readFileSync(colorFile(root), 'utf8');
  assert.match(stored, /^\{\n  "cores": \{/);
  assert.match(stored, /\n\}\n$/);
  const names = fs.readdirSync(path.join(root, '.sophy'));
  assert.equal(names.some((name) => name.startsWith('.tags-')), false);
  assert.equal(names.includes('tags.json'), true);

  const cleared = callTool('tag.color.set', {
    libraryPath: root,
    tag: '#ação',
    cor: null,
    origin: 'ui',
  }) as { tag: string; cor: null };
  assert.deepEqual(cleared, { tag: 'ação', cor: null });
  const emptied = callTool('tag.color.set', {
    libraryPath: root,
    tag: 'azul',
    cor: '',
    origin: 'ui',
  }) as { tag: string; cor: null };
  assert.deepEqual(emptied, { tag: 'azul', cor: null });
  const left = callTool('tag.color.get', { libraryPath: root }) as Record<string, string>;
  assert.equal(left.ação, undefined);
  assert.equal(left.azul, undefined);
  const missing = callTool('tag.color.set', {
    libraryPath: root,
    tag: 'nao-tinha',
    cor: '',
    origin: 'ui',
  }) as { tag: string; cor: null };
  assert.deepEqual(missing, { tag: 'nao-tinha', cor: null });
});

test('leitura tolera arquivo ausente, corrompido ou com entrada inválida e não regrava', () => {
  const { root } = fixture();
  fs.mkdirSync(path.join(root, '.sophy'));
  const file = colorFile(root);
  fs.writeFileSync(file, '{');
  assert.deepEqual(callTool('tag.color.get', { libraryPath: root }), {});
  assert.equal(fs.readFileSync(file, 'utf8'), '{');
  fs.writeFileSync(file, '[]');
  assert.deepEqual(callTool('tag.color.get', { libraryPath: root }), {});
  fs.writeFileSync(file, '{"cores":"azul"}');
  assert.deepEqual(callTool('tag.color.get', { libraryPath: root }), {});
  const mixed = `${JSON.stringify({
    cores: { Ação: 'Azul', '123': 'azul', ruim: 'neon', ação: '#AABBCC', extra: 1 },
  })}\n`;
  fs.writeFileSync(file, mixed);
  assert.deepEqual(callTool('tag.color.get', { libraryPath: root }), { ação: '#aabbcc' });
  assert.equal(fs.readFileSync(file, 'utf8'), mixed);
  fs.writeFileSync(file, '{');
  assert.deepEqual(callTool('tag.color.set', { libraryPath: root, tag: 'alfa', cor: 'azul', origin: 'ui' }), {
    tag: 'alfa',
    cor: 'azul',
  });
  assert.deepEqual(readColors(root).cores, { alfa: 'azul' });
  assert.equal(
    fs.readdirSync(path.join(root, '.sophy')).some((name) => name.startsWith('.tags-')),
    false,
  );
});

test('tag inválida e cor inválida não gravam', () => {
  const { root } = fixture();
  create(root, 'Estudos/A.md', '#real\n');
  callTool('tag.color.set', { libraryPath: root, tag: 'real', cor: 'verde', origin: 'ui' });
  const before = fs.readFileSync(colorFile(root), 'utf8');
  for (const tag of ['123', '#', 'a b', 'a//b']) {
    assert.throws(
      () => callTool('tag.color.set', { libraryPath: root, tag, cor: 'azul', origin: 'ui' }),
      (error: unknown) => error instanceof EngineError && error.code === 'tag_invalida',
    );
  }
  for (const cor of ['neon', '#fff', '#gggggg', 'estante', '1', '   ', 'null', '#c45b45ff']) {
    assert.throws(
      () => callTool('tag.color.set', { libraryPath: root, tag: 'real', cor, origin: 'ui' }),
      (error: unknown) => error instanceof EngineError && error.code === 'cor_invalida',
    );
  }
  assert.throws(() => callTool('tag.color.set', { libraryPath: root, tag: 'real', cor: 'azul' }));
  assert.throws(() =>
    callTool('tag.color.set', { libraryPath: root, tag: 'real', cor: 1, origin: 'ui' }),
  );
  assert.equal(fs.readFileSync(colorFile(root), 'utf8'), before);
});

test('a cor não vira nota, anexo nem nó, e o histórico não a guarda', () => {
  const { root } = fixture();
  create(root, 'Estudos/A.md', 'Texto sem a cor.\n#alfa\n');
  const before = (callTool('history.list', { libraryPath: root }) as unknown[]).length;
  callTool('tag.color.set', { libraryPath: root, tag: 'alfa', cor: '#c45b45', origin: 'ui' });
  assert.equal((callTool('history.list', { libraryPath: root }) as unknown[]).length, before);
  const hidden = (item: { path: string }) => item.path.includes('.sophy') || item.path.endsWith('tags.json');
  const notes = callTool('note.list', { libraryPath: root }) as Array<{ path: string }>;
  const files = callTool('file.list', { libraryPath: root }) as Array<{ path: string }>;
  const graph = callTool('graph.query', { libraryPath: root }) as { nodes: Array<{ path: string }> };
  const hits = callTool('search.query', { libraryPath: root, query: 'c45b45' }) as Array<{ path: string }>;
  const shelves = callTool('workspace.list', { libraryPath: root }) as Array<{ name: string }>;
  assert.equal(notes.some(hidden), false);
  assert.equal(files.some(hidden), false);
  assert.equal(graph.nodes.some(hidden), false);
  assert.equal(hits.some(hidden), false);
  assert.equal(shelves.some((shelf) => shelf.name === '.sophy'), false);
  assert.equal(toolMutates('tag.color.set'), true);
  assert.equal(toolMutates('tag.color.get'), false);
  assert.equal(toolMutates('tags.related'), false);
});

test('renomear migra a cor e o desfazer volta só as notas', () => {
  const { root } = fixture();
  create(root, 'Estudos/A.md', '#Projeto e #projeto/sophy\n');
  create(root, 'Estudos/B.md', '#novo\n');
  callTool('tag.color.set', { libraryPath: root, tag: 'Projeto', cor: 'azul', origin: 'ui' });
  callTool('tag.color.set', { libraryPath: root, tag: 'projeto/sophy', cor: 'verde', origin: 'ui' });
  callTool('tag.color.set', { libraryPath: root, tag: 'novo', cor: 'vermelho', origin: 'ui' });
  callTool('tag.color.set', { libraryPath: root, tag: 'outro', cor: 'rosa', origin: 'ui' });
  callTool('tag.rename', { libraryPath: root, from: '#projeto', to: 'novo', origin: 'ui' });
  assert.deepEqual(readColors(root).cores, {
    novo: 'vermelho',
    'novo/sophy': 'verde',
    outro: 'rosa',
  });
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8'), /#novo e #novo\/sophy/);
  const history = (callTool('history.list', { libraryPath: root }) as unknown[]).length;
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8'), /#Projeto e #projeto\/sophy/);
  assert.deepEqual(readColors(root).cores, {
    novo: 'vermelho',
    'novo/sophy': 'verde',
    outro: 'rosa',
  });
  assert.equal((callTool('history.list', { libraryPath: root }) as unknown[]).length, history - 1);

  const kept = fs.readFileSync(colorFile(root), 'utf8');
  callTool('tag.rename', { libraryPath: root, from: 'projeto', to: 'projeto', origin: 'ui' });
  assert.equal(fs.readFileSync(colorFile(root), 'utf8'), kept);

  const bare = fixture();
  create(bare.root, 'Estudos/C.md', '#so\n');
  callTool('tag.rename', { libraryPath: bare.root, from: 'so', to: 'outra', origin: 'ui' });
  assert.equal(fs.existsSync(colorFile(bare.root)), false);

  assert.throws(
    () => callTool('tag.rename', { libraryPath: root, from: 'ausente', to: 'x', origin: 'ui' }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_inexistente',
  );
  assert.deepEqual(readColors(root).cores.outro, 'rosa');
});

test('tags.related ordena por notas em comum e usa o mesmo conjunto de tags.notes', () => {
  const records = [
    {
      path: 'Estudos/A.md',
      title: 'A',
      mtime: 1,
      tagRecords: [
        { key: 'alvo', name: 'Alvo', source: 'text' },
        { key: 'comum', name: 'Comum', source: 'text' },
        { key: 'ação', name: 'Ação', source: 'text' },
        { key: 'ação', name: 'acao-repetida', source: 'frontmatter' },
      ] satisfies NoteTag[],
    },
    {
      path: 'Estudos/B.md',
      title: 'B',
      mtime: 2,
      tagRecords: [
        { key: 'alvo', name: 'alvo', source: 'frontmatter' },
        { key: 'comum', name: 'comum', source: 'text' },
        { key: 'beta', name: 'beta', source: 'text' },
      ] satisfies NoteTag[],
    },
    {
      path: 'Estudos/C.md',
      title: 'C',
      mtime: 3,
      tagRecords: [
        { key: 'alvo/filho', name: 'alvo/filho', source: 'text' },
        { key: 'comum', name: 'comum', source: 'text' },
      ] satisfies NoteTag[],
    },
  ];
  assert.deepEqual(relatedTags(records, '#Alvo'), [
    { tag: 'Comum', juntas: 3 },
    { tag: 'Ação', juntas: 1 },
    { tag: 'alvo/filho', juntas: 1 },
    { tag: 'beta', juntas: 1 },
  ]);
  assert.throws(
    () => relatedTags(records, '123'),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_invalida',
  );
  assert.throws(
    () => relatedTags(records, 'ausente'),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_inexistente',
  );
  assert.deepEqual(relatedTags([{ path: 'S.md', title: 'S', mtime: 1, tagRecords: [{ key: 'sozinha', name: 'sozinha', source: 'text' }] }], 'sozinha'), []);

  const { root } = fixture();
  create(root, 'Estudos/A.md', 'texto #alvo #junto\n', { tags: ['junto', 'alvo'] });
  create(root, 'Estudos/B.md', '#alvo\n');
  create(root, 'Estudos/C.md', '#alvo/filho #gama\n');
  create(root, 'Estudos/Cerca.md', '```\n#so-na-cerca #junto\n```\n');
  const notes = callTool('tags.notes', { libraryPath: root, tag: 'alvo' }) as { notes: Array<{ path: string }> };
  assert.deepEqual(
    notes.notes.map((note) => note.path),
    ['Estudos/A.md', 'Estudos/B.md', 'Estudos/C.md'],
  );
  assert.deepEqual(callTool('tags.related', { libraryPath: root, tag: '#ALVO' }), [
    { tag: 'alvo/filho', juntas: 1 },
    { tag: 'gama', juntas: 1 },
    { tag: 'junto', juntas: 1 },
  ]);
  assert.throws(
    () => callTool('tags.related', { libraryPath: root, tag: 'so-na-cerca' }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_inexistente',
  );
  assert.throws(
    () => callTool('tags.related', { libraryPath: root, tag: '123' }),
    (error: unknown) => error instanceof EngineError && error.code === 'tag_invalida',
  );
  assert.deepEqual(callTool('tags.related', { libraryPath: root, tag: 'alvo/filho' }), [
    { tag: 'gama', juntas: 1 },
  ]);
});
