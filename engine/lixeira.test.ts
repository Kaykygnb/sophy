import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EngineError } from './errors.ts';
import { createNote, listNotes, openLibrary } from './library.ts';
import { ignoredByWatch, linkGeneration, outgoingLinks, watchLibrary } from './links.ts';
import { emptyTrash, listTrash, purgeTrash, restoreTrash, trashEntry } from './lixeira.ts';
import { searchLibrary } from './search.ts';
import { callTool } from './tools.ts';
import { queryGraph } from './graph.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-lixeira-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  return openLibrary(root);
}

test('a lixeira guarda metadados, lista do mais recente e não usa a lixeira do sistema', () => {
  const opened = library();
  const previous = process.env.XDG_DATA_HOME;
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-xdg-'));
  process.env.XDG_DATA_HOME = xdg;
  try {
    const older = trashEntry(opened, 'Estudos', { now: new Date('2026-01-01T00:00:00Z') });
    fs.mkdirSync(path.join(opened.root, 'Estudos'), { recursive: true });
    fs.writeFileSync(path.join(opened.root, 'Estudos', 'Nota.md'), 'texto');
    const newer = trashEntry(opened, 'Estudos\\Nota.md', { now: new Date('2026-06-01T00:00:00Z') });
    assert.equal(newer.path, 'Estudos/Nota.md');
    assert.equal(newer.id.includes('\\'), false);
    assert.equal(fs.existsSync(path.join(xdg, 'Trash', 'files')), false);
    const items = listTrash(opened);
    assert.deepEqual(
      items.map((item) => item.originalPath),
      ['Estudos/Nota.md', 'Estudos'],
    );
    assert.equal(items[0].kind, 'note');
    assert.equal(items[0].title, 'Nota');
    assert.equal(items[1].kind, 'folder');
    assert.equal(items[0].size, Buffer.byteLength('texto'));
    assert.deepEqual(Object.keys(items[0]).sort(), ['deletedAt', 'id', 'kind', 'originalPath', 'size', 'title']);
    const listed = callTool('trash.list', { libraryPath: opened.root }) as Array<{ id: string }>;
    assert.equal(listed[0].id, newer.id);
    assert.equal(listed[1].id, older.id);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
});

test('restaurar devolve o original, o sufixo e a pasta que sumiu', () => {
  const opened = library();
  createNote(opened, 'Estudos/Nota.md', 'voltar\n');
  const removed = trashEntry(opened, 'Estudos/Nota.md');
  fs.writeFileSync(path.join(opened.root, 'Estudos', 'Nota.md'), 'ocupado\n');
  fs.writeFileSync(path.join(opened.root, 'Estudos', 'Nota (restaurado).md'), 'primeiro\n');
  const restored = restoreTrash(opened, removed.id);
  assert.equal(restored.path, 'Estudos/Nota (restaurado 2).md');
  assert.match(fs.readFileSync(path.join(opened.root, 'Estudos', 'Nota (restaurado 2).md'), 'utf8'), /voltar/);
  assert.equal(listTrash(opened).length, 0);

  createNote(opened, 'Estudos/Sub/Folha.md', 'folha\n');
  const nested = trashEntry(opened, 'Estudos/Sub/Folha.md');
  fs.rmSync(path.join(opened.root, 'Estudos', 'Sub'), { recursive: true, force: true });
  const back = restoreTrash(opened, nested.id);
  assert.equal(back.path, 'Estudos/Sub/Folha.md');
  assert.match(fs.readFileSync(path.join(opened.root, 'Estudos', 'Sub', 'Folha.md'), 'utf8'), /folha/);
});

test('purgar, esvaziar e apagar de vez não mexem no resto de .sophy', () => {
  const opened = library();
  createNote(opened, 'Estudos/Um.md', 'um\n');
  createNote(opened, 'Estudos/Dois.md', 'dois\n');
  const first = trashEntry(opened, 'Estudos/Um.md');
  trashEntry(opened, 'Estudos/Dois.md');
  fs.writeFileSync(path.join(opened.root, '.sophy', 'history.json'), '{"actions":[]}\n');
  fs.writeFileSync(path.join(opened.root, '.sophy', 'lixeira', 'nota.txt'), 'fica\n');
  const purged = callTool('trash.purge', { libraryPath: opened.root, id: first.id, origin: 'ui' }) as {
    purged: boolean;
  };
  assert.equal(purged.purged, true);
  assert.equal(listTrash(opened).length, 1);
  const emptied = callTool('trash.empty', { libraryPath: opened.root, origin: 'cli' }) as { purged: number };
  assert.equal(emptied.purged, 1);
  assert.equal(listTrash(opened).length, 0);
  assert.equal(fs.readFileSync(path.join(opened.root, '.sophy', 'history.json'), 'utf8'), '{"actions":[]}\n');
  assert.equal(fs.readFileSync(path.join(opened.root, '.sophy', 'lixeira', 'nota.txt'), 'utf8'), 'fica\n');

  createNote(opened, 'Estudos/Fim.md', 'fim\n');
  const deleted = callTool('note.deletePermanent', {
    libraryPath: opened.root,
    path: 'Estudos/Fim.md',
    origin: 'ui',
  }) as { deleted: boolean };
  assert.equal(deleted.deleted, true);
  assert.equal(fs.existsSync(path.join(opened.root, 'Estudos', 'Fim.md')), false);
  assert.equal(listTrash(opened).length, 0);
  callTool('history.undo', { libraryPath: opened.root, origin: 'ui' });
  assert.match(fs.readFileSync(path.join(opened.root, 'Estudos', 'Fim.md'), 'utf8'), /fim/);
});

test('desfazer a exclusão restaura o arquivo e tira só a cópia mais recente', () => {
  const opened = library();
  createNote(opened, 'Estudos/Nota.md', 'primeira\n');
  trashEntry(opened, 'Estudos/Nota.md', { now: new Date('2026-01-01T00:00:00Z') });
  fs.writeFileSync(path.join(opened.root, 'Estudos', 'Nota.md'), 'segunda\n');
  const again = callTool('entry.trash', {
    libraryPath: opened.root,
    path: 'Estudos/Nota.md',
    origin: 'ui',
  }) as { id: string };
  callTool('history.undo', { libraryPath: opened.root, origin: 'ui' });
  assert.match(fs.readFileSync(path.join(opened.root, 'Estudos', 'Nota.md'), 'utf8'), /segunda/);
  const left = listTrash(opened);
  assert.equal(left.length, 1);
  assert.notEqual(left[0].id, again.id);
  assert.equal(left[0].originalPath, 'Estudos/Nota.md');
});

test('id inválido, falha de rename e cópia entre discos não perdem o original', () => {
  const opened = library();
  createNote(opened, 'Estudos/Nota.md', 'salvo\n');
  assert.throws(
    () => restoreTrash(opened, 'nao-e-id'),
    (error: unknown) => error instanceof EngineError && /Identificador de lixeira inválido/.test(error.message),
  );
  assert.throws(
    () => purgeTrash(opened, '..\\segredo'),
    (error: unknown) => error instanceof EngineError && /Identificador de lixeira inválido/.test(error.message),
  );

  const original = fs.renameSync;
  fs.renameSync = () => {
    const error = new Error('acesso') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    throw error;
  };
  try {
    assert.throws(() => trashEntry(opened, 'Estudos/Nota.md'), /Nada foi apagado/);
  } finally {
    fs.renameSync = original;
  }
  assert.equal(fs.readFileSync(path.join(opened.root, 'Estudos', 'Nota.md'), 'utf8').includes('salvo'), true);
  assert.equal(fs.readdirSync(path.join(opened.root, '.sophy', 'lixeira')).length, 0);

  fs.renameSync = () => {
    const error = new Error('EXDEV') as NodeJS.ErrnoException;
    error.code = 'EXDEV';
    throw error;
  };
  try {
    const moved = trashEntry(opened, 'Estudos/Nota.md');
    assert.equal(fs.existsSync(path.join(opened.root, 'Estudos', 'Nota.md')), false);
    assert.match(fs.readFileSync(moved.trashPath, 'utf8'), /salvo/);
  } finally {
    fs.renameSync = original;
  }
});

test('a lixeira fica fora da árvore, da busca, do grafo e do vigia, e o link volta', async () => {
  const opened = library();
  createNote(opened, 'Estudos/Alvo.md', 'alvo unico\n');
  createNote(opened, 'Estudos/Fonte.md', 'Veja [[Alvo]]\n');
  const removed = trashEntry(opened, 'Estudos/Alvo.md');
  assert.equal(
    listNotes(opened).some((note) => note.path.includes('lixeira') || note.path === 'Estudos/Alvo.md'),
    false,
  );
  assert.equal(searchLibrary(opened, 'alvo unico').length, 0);
  assert.equal(
    queryGraph(opened).nodes.some((node) => node.path === 'Estudos/Alvo.md' || node.path.includes('.sophy')),
    false,
  );
  assert.equal(outgoingLinks(opened, 'Estudos/Fonte.md')[0].status, 'broken');
  assert.equal(ignoredByWatch('.sophy/lixeira/' + removed.id + '/Alvo.md'), true);
  assert.equal(ignoredByWatch('Estudos\\Nota.md'), false);
  assert.equal(ignoredByWatch('Estudos/Fonte.md'), false);

  watchLibrary(opened, true);
  try {
    const before = linkGeneration(opened.root);
    fs.writeFileSync(path.join(opened.root, '.sophy', 'oculto.md'), 'oculto\n');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(linkGeneration(opened.root), before);
    const restored = restoreTrash(opened, removed.id);
    assert.equal(restored.path, 'Estudos/Alvo.md');
    assert.equal(outgoingLinks(opened, 'Estudos/Fonte.md')[0].status, 'resolved');
    fs.writeFileSync(path.join(opened.root, 'Estudos', 'Visivel.md'), 'visivel\n');
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(linkGeneration(opened.root) > before, true);
  } finally {
    watchLibrary(opened, false);
  }
});
