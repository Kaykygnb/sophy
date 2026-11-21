import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EngineError } from './errors.ts';
import { MAX_NOTE_BYTES } from './limits.ts';
import {
  createNote,
  createWorkspace,
  listNotes,
  listWorkspaces,
  moveEntry,
  openLibrary,
  readNote,
  writeNote,
} from './library.ts';
import { trashEntry } from './lixeira.ts';
import { splitMarkdown } from './markdown.ts';
import { callTool, listTools } from './tools.ts';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-home-'));
  const root = path.join(home, 'biblioteca');
  fs.mkdirSync(root);
  return { home, root };
}

test('abrir a pasta lista estantes sem cadastro e ignora ocultos, .notas1 e links', () => {
  const { home, root } = fixture();
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.mkdirSync(path.join(root, 'Livro'));
  fs.mkdirSync(path.join(root, '.notas1'));
  fs.mkdirSync(path.join(root, '.oculto'));
  fs.writeFileSync(path.join(root, 'Solta.md'), 'na raiz\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Nota.md'), 'dentro\n');
  fs.writeFileSync(path.join(root, '.oculto', 'Segredo.md'), 'nao\n');
  fs.symlinkSync(path.join(root, 'Estudos'), path.join(root, 'Atalho'));
  const library = openLibrary(root, { home, cwd: home });
  assert.deepEqual(
    listWorkspaces(library).map((item) => item.name),
    ['Estudos', 'Livro'],
  );
  const notes = listNotes(library);
  assert.deepEqual(
    notes.map((note) => [note.path, note.workspace]),
    [
      ['Estudos/Nota.md', 'Estudos'],
      ['Solta.md', null],
    ],
  );
  assert.equal(fs.existsSync(path.join(root, '.notas1', 'world.json')), false);
});

test('nota é só .md; .canvas fica canvas e o resto é anexo sem envelope', () => {
  const { home, root } = fixture();
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Estudos', 'Nota.md'), '[[\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Mapa.canvas'), '{"nodes":[],"edges":[]}\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'foto.png'), 'PNG');
  const library = openLibrary(root, { home, cwd: home });
  assert.deepEqual(
    listNotes(library).map((note) => note.path),
    ['Estudos/Nota.md'],
  );
  assert.throws(() => readNote(library, 'Estudos/Mapa.canvas'), EngineError);
  assert.throws(() => readNote(library, 'Estudos/foto.png'), EngineError);
  const files = callTool('file.list', { libraryPath: root, workspace: 'Estudos' }) as Array<{
    path: string;
    kind: string;
  }>;
  assert.deepEqual(
    files.map((file) => [file.path, file.kind]).sort(),
    [
      ['Estudos/Mapa.canvas', 'canvas'],
      ['Estudos/foto.png', 'attachment'],
    ].sort(),
  );
  assert.equal(
    fs.readFileSync(path.join(root, 'Estudos', 'Mapa.canvas'), 'utf8'),
    '{"nodes":[],"edges":[]}\n',
  );
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'foto.png'), 'utf8'), 'PNG');
});

test('corpo que entra é o corpo que sai, inclusive [[ incompleto', () => {
  const { home, root } = fixture();
  const library = openLibrary(root, { home, cwd: home });
  createWorkspace(library, 'Estudos');
  const body = 'Texto com [[ e também \\[\\[ e *negrito* sem escape.\n';
  const created = createNote(library, 'Estudos/Ideia.md', body);
  assert.equal(created.body, body);
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Ideia.md'), 'utf8'), body);
  const saved = writeNote(library, 'Estudos/Ideia.md', {
    body: '[[',
    expectedRevision: created.revision,
  });
  assert.equal(saved.conflict, false);
  if (saved.conflict) return;
  assert.equal(saved.note.body, '[[');
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Ideia.md'), 'utf8'), '[[');
  assert.equal(saved.note.body.includes('\\'), false);
});

test('frontmatter legado é preservado e o corpo continua Markdown limpo', () => {
  const { home, root } = fixture();
  const legacy =
    '---\n' +
    'tags:\n  - estudo\n' +
    'notas1_editor: {"version":1,"structure":[{"id":"x"}]}\n' +
    '---\n' +
    'Corpo [[aberto\n';
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Estudos', 'Velha.md'), legacy);
  const library = openLibrary(root, { home, cwd: home });
  const note = readNote(library, 'Estudos/Velha.md');
  assert.equal(note.body, 'Corpo [[aberto\n');
  assert.deepEqual(note.frontmatter?.tags, ['estudo']);
  assert.equal(typeof note.frontmatter?.notas1_editor, 'object');
  const saved = writeNote(library, 'Estudos/Velha.md', {
    body: 'Corpo [[aberto e novo\n',
    expectedRevision: note.revision,
  });
  assert.equal(saved.conflict, false);
  const disk = fs.readFileSync(path.join(root, 'Estudos', 'Velha.md'), 'utf8');
  assert.match(disk, /notas1_editor: \{"version":1,"structure":\[\{"id":"x"\}\]\}/);
  assert.match(disk, /tags:\n {2}- estudo/);
  assert.equal(splitMarkdown(disk).body, 'Corpo [[aberto e novo\n');
});

test('CRLF e atualização explícita de frontmatter não escapam o corpo', () => {
  const { home, root } = fixture();
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Estudos', 'Win.md'), '---\r\ntitle: Velho\r\n---\r\nLinha\r\n');
  const library = openLibrary(root, { home, cwd: home });
  const note = readNote(library, 'Estudos/Win.md');
  assert.equal(note.body, 'Linha\r\n');
  const saved = writeNote(library, 'Estudos/Win.md', {
    body: '[[\r\n',
    frontmatter: { title: 'Novo', tags: ['a'] },
    expectedRevision: note.revision,
  });
  assert.equal(saved.conflict, false);
  if (saved.conflict) return;
  assert.equal(saved.note.body, '[[\r\n');
  assert.equal(saved.note.frontmatter?.title, 'Novo');
  const disk = fs.readFileSync(path.join(root, 'Estudos', 'Win.md'), 'utf8');
  assert.equal(disk.endsWith('[[\r\n'), true);
  assert.equal(disk.includes('\\['), false);
});

test('revisão SHA-256 impede sobrescrever alteração externa', () => {
  const { home, root } = fixture();
  const library = openLibrary(root, { home, cwd: home });
  const created = createNote(library, 'Nota.md', 'um\n');
  fs.writeFileSync(path.join(root, 'Nota.md'), 'externo\n');
  const result = writeNote(library, 'Nota.md', {
    body: 'local\n',
    expectedRevision: created.revision,
  });
  assert.equal(result.conflict, true);
  if (!result.conflict) return;
  assert.equal(result.current.body, 'externo\n');
  assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'externo\n');
  assert.equal(result.current.revision, createHash('sha256').update('externo\n').digest('hex'));
  assert.equal(
    fs.readdirSync(root).some((name) => name.startsWith('.sophy-save-')),
    false,
  );
});

test('caminho preso à biblioteca, link simbólico e tamanho são recusados', () => {
  const { home, root } = fixture();
  const outside = path.join(home, 'fora');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'segredo.md'), 'x');
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.symlinkSync(outside, path.join(root, 'Estudos', 'atalho'));
  fs.symlinkSync(path.join(root, 'Estudos'), path.join(root, 'Espelho'));
  const library = openLibrary(root, { home, cwd: home });
  assert.throws(() => readNote(library, '../fora/segredo.md'), EngineError);
  assert.throws(() => readNote(library, '/etc/passwd'), EngineError);
  assert.throws(() => readNote(library, 'Estudos\\Nota.md'), EngineError);
  assert.throws(
    () => readNote(library, 'Estudos/atalho/segredo.md'),
    (error: unknown) => {
      assert.equal(error instanceof EngineError && error.code, 'symlink');
      return true;
    },
  );
  assert.equal(
    listNotes(library).some((note) => note.path.includes('atalho')),
    false,
  );
  assert.throws(
    () => createNote(library, 'Grande.md', 'a'.repeat(MAX_NOTE_BYTES + 1)),
    (error: unknown) => {
      assert.equal(error instanceof EngineError && error.code, 'too-large');
      return true;
    },
  );
  assert.throws(() => openLibrary(home, { home, cwd: path.join(home, 'outro') }), EngineError);
  assert.throws(() => openLibrary(path.join(home, '.ssh'), { home, cwd: home }), EngineError);
});

test('criar, mover e lixeira não apagam o original se a lixeira não recebe o item', () => {
  const { home, root } = fixture();
  const library = openLibrary(root, { home, cwd: home });
  createWorkspace(library, 'Estudos');
  createNote(library, 'Estudos/Nota.md', '[[\n');
  const moved = moveEntry(library, 'Estudos/Nota.md', 'Livro/Movida.md');
  assert.equal(moved.path, 'Livro/Movida.md');
  assert.equal(readNote(library, 'Livro/Movida.md').body, '[[\n');
  assert.equal(
    listWorkspaces(library).some((item) => item.name === 'Livro'),
    true,
  );
  assert.throws(() => moveEntry(library, 'Livro', 'Livro/dentro/mais'), EngineError);
  assert.equal(fs.existsSync(path.join(root, 'Livro', 'dentro')), false);
  const outside = path.join(home, 'alvo.txt');
  fs.writeFileSync(outside, 'permanece');
  fs.mkdirSync(path.join(root, 'Caixa'));
  fs.symlinkSync(outside, path.join(root, 'Caixa', 'atalho'));
  const trashed = trashEntry(library, 'Caixa');
  assert.equal(trashed.trashed, true);
  assert.equal(fs.existsSync(path.join(root, 'Caixa')), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'permanece');
  const meta = JSON.parse(
    fs.readFileSync(path.join(path.dirname(trashed.trashPath), '.meta.json'), 'utf8'),
  ) as { kind: string; originalPath: string };
  assert.equal(meta.kind, 'folder');
  assert.equal(meta.originalPath, 'Caixa');
  assert.equal(fs.existsSync(outside), true);
});

test('criar não sobrescreve e a tool rejeita entrada inválida', () => {
  const { home, root } = fixture();
  const library = openLibrary(root, { home, cwd: home });
  createNote(library, 'Nota.md', 'um');
  assert.throws(
    () => createNote(library, 'Nota.md', 'dois'),
    (error: unknown) => {
      assert.equal(error instanceof EngineError && error.code, 'exists');
      return true;
    },
  );
  assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'um');
  const names = listTools().map((tool) => tool.name);
  assert.equal(names.includes('library.open'), true);
  assert.equal(names.includes('note.write'), true);
  const opened = callTool('library.open', { path: root });
  assert.ok(opened !== null && typeof opened === 'object' && 'root' in opened);
  assert.throws(() => callTool('note.write', { libraryPath: root }), /revision|expected/i);
  assert.throws(() => callTool('missing.tool', {}), EngineError);
});

test('a tool grava [[ sem escape e preserva o frontmatter quando ele é omitido', () => {
  const { home, root } = fixture();
  const previous = process.env.XDG_DATA_HOME;
  const xdg = path.join(home, 'xdg');
  process.env.XDG_DATA_HOME = xdg;
  try {
    callTool('note.create', {
      libraryPath: root,
      path: 'Estudos/Diario.md',
      body: '---\n',
      frontmatter: { tags: ['dia'] },
      origin: 'ui',
    });
    const read = callTool('note.read', { libraryPath: root, path: 'Estudos/Diario.md' }) as {
      body: string;
      revision: string;
      frontmatter: { tags: string[] };
      workspace: string;
    };
    assert.equal(read.workspace, 'Estudos');
    assert.deepEqual(read.frontmatter.tags, ['dia']);
    const written = callTool('note.write', {
      libraryPath: root,
      path: 'Estudos/Diario.md',
      body: '[[',
      expectedRevision: read.revision,
      origin: 'ui',
    }) as { conflict: boolean; note: { body: string } };
    assert.equal(written.conflict, false);
    assert.equal(written.note.body, '[[');
    const disk = fs.readFileSync(path.join(root, 'Estudos', 'Diario.md'), 'utf8');
    assert.match(disk, /^---\n/);
    assert.match(disk, /tags:\n {2}- dia\n/);
    assert.equal(disk.endsWith('[['), true);
    callTool('entry.move', {
      libraryPath: root,
      from: 'Estudos/Diario.md',
      to: 'Estudos/Amanha.md',
      origin: 'cli',
    });
    callTool('entry.trash', { libraryPath: root, path: 'Estudos/Amanha.md', origin: 'mcp' });
    assert.equal(fs.existsSync(path.join(root, 'Estudos', 'Amanha.md')), false);
    assert.equal(fs.existsSync(path.join(xdg, 'Trash', 'files')), false);
    const kept = fs.readdirSync(path.join(root, '.sophy', 'lixeira'));
    assert.equal(kept.length, 1);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
});
