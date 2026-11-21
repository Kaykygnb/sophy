import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { EngineError } from './errors.ts';
import { ignoredByWatch, linkGeneration } from './links.ts';
import {
  listDirectories,
  listFiles,
  listNotes,
  listWorkspaces,
  openLibrary,
} from './library.ts';
import { deletePermanent, listTrash, restoreTrash, trashEntry } from './lixeira.ts';
import { callTool } from './tools.ts';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-lixeira-'));
  const root = path.join(home, 'biblioteca');
  fs.mkdirSync(root);
  return { home, root, library: openLibrary(root, { home, cwd: home }) };
}

function metaOf(root: string, id: string) {
  return JSON.parse(
    fs.readFileSync(path.join(root, '.sophy', 'lixeira', id, '.meta.json'), 'utf8'),
  ) as {
    id: string;
    originalPath: string;
    title: string;
    kind: string;
    deletedAt: string;
    size: number;
  };
}

test('excluir move para .sophy/lixeira com metadados e a lista vem da mais recente', () => {
  const { root, library } = fixture();
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Estudos', 'Antiga.md'), 'antiga\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Nova.md'), 'nova\n');
  const older = trashEntry(library, 'Estudos/Antiga.md', {
    now: new Date('2020-01-01T00:00:00.000Z'),
  });
  const newer = trashEntry(library, 'Estudos/Nova.md', {
    now: new Date('2024-05-01T12:00:00.000Z'),
  });
  assert.equal(fs.existsSync(path.join(root, 'Estudos', 'Antiga.md')), false);
  assert.equal(fs.readFileSync(older.trashPath, 'utf8'), 'antiga\n');
  const olderMeta = metaOf(root, older.id);
  assert.equal(olderMeta.id, older.id);
  assert.match(olderMeta.id, /^[0-9]{12,16}-[a-f0-9]{8}$/);
  assert.equal(olderMeta.originalPath, 'Estudos/Antiga.md');
  assert.equal(olderMeta.title, 'Antiga');
  assert.equal(olderMeta.kind, 'note');
  assert.equal(olderMeta.deletedAt, '2020-01-01T00:00:00.000Z');
  assert.equal(olderMeta.size, Buffer.byteLength('antiga\n'));
  const newerMeta = metaOf(root, newer.id);
  assert.equal(newerMeta.kind, 'note');
  assert.equal(newerMeta.title, 'Nova');
  const listed = callTool('trash.list', { libraryPath: root }) as Array<{
    id: string;
    originalPath: string;
  }>;
  assert.deepEqual(
    listed.map((item) => item.originalPath),
    ['Estudos/Nova.md', 'Estudos/Antiga.md'],
  );
  assert.equal(listed[0].id, newer.id);
});

test('restaurar devolve o arquivo, recria a pasta e evita conflito com (restaurado)', () => {
  const { root, library } = fixture();
  fs.mkdirSync(path.join(root, 'Estudos', 'Sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Sub', 'Nota.md'), 'original\n');
  fs.writeFileSync(path.join(root, 'Solta.md'), 'solta\n');
  fs.writeFileSync(path.join(root, 'Ocupada.md'), 'primeira\n');
  const nested = trashEntry(library, 'Estudos/Sub/Nota.md');
  const plain = trashEntry(library, 'Solta.md');
  const clash = trashEntry(library, 'Ocupada.md');
  fs.rmdirSync(path.join(root, 'Estudos', 'Sub'));
  fs.rmdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Ocupada.md'), 'nova\n');
  fs.writeFileSync(path.join(root, 'Ocupada (restaurado).md'), 'ja-existe\n');

  const restoredNested = callTool('trash.restore', {
    libraryPath: root,
    id: nested.id,
    origin: 'ui',
  }) as { path: string };
  assert.equal(restoredNested.path, 'Estudos/Sub/Nota.md');
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Sub', 'Nota.md'), 'utf8'), 'original\n');

  const restoredPlain = restoreTrash(library, plain.id);
  assert.equal(restoredPlain.path, 'Solta.md');
  assert.equal(fs.readFileSync(path.join(root, 'Solta.md'), 'utf8'), 'solta\n');

  const restoredClash = callTool('trash.restore', {
    libraryPath: root,
    id: clash.id,
    origin: 'cli',
  }) as { path: string };
  assert.equal(restoredClash.path, 'Ocupada (restaurado 2).md');
  assert.equal(fs.readFileSync(path.join(root, 'Ocupada.md'), 'utf8'), 'nova\n');
  assert.equal(fs.readFileSync(path.join(root, 'Ocupada (restaurado).md'), 'utf8'), 'ja-existe\n');
  assert.equal(fs.readFileSync(path.join(root, 'Ocupada (restaurado 2).md'), 'utf8'), 'primeira\n');
  assert.equal(listTrash(library).length, 0);
});

test('o primeiro conflito usa (restaurado) antes da extensão', () => {
  const { root, library } = fixture();
  fs.writeFileSync(path.join(root, 'Foto.png'), 'png-velha');
  fs.writeFileSync(path.join(root, 'Quadro.canvas'), '{"nodes":[]}\n');
  const photo = trashEntry(library, 'Foto.png');
  const canvas = trashEntry(library, 'Quadro.canvas');
  fs.writeFileSync(path.join(root, 'Foto.png'), 'png-nova');
  fs.writeFileSync(path.join(root, 'Quadro.canvas'), '{"nodes":[1]}\n');
  const photoMeta = metaOf(root, photo.id);
  const canvasMeta = metaOf(root, canvas.id);
  assert.equal(photoMeta.kind, 'attachment');
  assert.equal(photoMeta.title, 'Foto.png');
  assert.equal(canvasMeta.kind, 'canvas');
  assert.equal(canvasMeta.title, 'Quadro');
  const restoredPhoto = restoreTrash(library, photo.id);
  const restoredCanvas = restoreTrash(library, canvas.id);
  assert.equal(restoredPhoto.path, 'Foto (restaurado).png');
  assert.equal(restoredCanvas.path, 'Quadro (restaurado).canvas');
  assert.equal(fs.readFileSync(path.join(root, 'Foto.png'), 'utf8'), 'png-nova');
  assert.equal(fs.readFileSync(path.join(root, 'Foto (restaurado).png'), 'utf8'), 'png-velha');
});

test('pasta inteira é um item, purge e empty só limpam a lixeira', () => {
  const { root, library } = fixture();
  fs.mkdirSync(path.join(root, 'Pacote', 'Miolo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Pacote', 'A.txt'), 'abc');
  fs.writeFileSync(path.join(root, 'Pacote', 'Miolo', 'B.txt'), 'abcd');
  fs.writeFileSync(path.join(root, 'Pacote', 'C.md'), 'palavra-da-pasta\n');
  fs.writeFileSync(path.join(root, 'Fica.md'), 'fica\n');
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sophy', 'estantes.json'), '{}\n');
  const folder = trashEntry(library, 'Pacote');
  const note = trashEntry(library, 'Fica.md', { now: new Date('2021-01-01T00:00:00.000Z') });
  const listed = listTrash(library);
  assert.equal(listed.length, 2);
  const folderItem = listed.find((item) => item.id === folder.id);
  assert.ok(folderItem);
  assert.equal(folderItem.kind, 'folder');
  assert.equal(folderItem.originalPath, 'Pacote');
  assert.equal(folderItem.title, 'Pacote');
  assert.equal(folderItem.size, Buffer.byteLength('abc') + Buffer.byteLength('abcd') + Buffer.byteLength('palavra-da-pasta\n'));
  assert.equal(fs.existsSync(path.join(folder.trashPath, 'A.txt')), true);
  assert.equal(fs.existsSync(path.join(folder.trashPath, 'Miolo', 'B.txt')), true);
  assert.equal(listNotes(library).some((item) => item.path.includes('Pacote')), false);
  assert.equal(
    (callTool('search.query', { libraryPath: root, query: 'palavra-da-pasta' }) as unknown[]).length,
    0,
  );
  const purged = callTool('trash.purge', { libraryPath: root, id: note.id, origin: 'ui' }) as {
    purged: boolean;
  };
  assert.equal(purged.purged, true);
  assert.equal(listTrash(library).length, 1);
  assert.equal(fs.existsSync(path.join(root, 'Fica.md')), false);
  const emptied = callTool('trash.empty', { libraryPath: root, origin: 'mcp' }) as { purged: number };
  assert.equal(emptied.purged, 1);
  assert.deepEqual(listTrash(library), []);
  assert.equal(fs.existsSync(path.join(root, 'Pacote')), false);
  assert.equal(fs.readFileSync(path.join(root, '.sophy', 'estantes.json'), 'utf8'), '{}\n');
  const again = callTool('trash.empty', { libraryPath: root, origin: 'ui' }) as { purged: number };
  assert.equal(again.purged, 0);
});

test('deletePermanent apaga sem lixeira e o desfazer regrava o snapshot', () => {
  const { root } = fixture();
  callTool('note.create', { libraryPath: root, path: 'Nota.md', body: 'permanente\n', origin: 'ui' });
  fs.writeFileSync(path.join(root, 'Quadro.canvas'), '{"nodes":[]}\n');
  fs.writeFileSync(path.join(root, 'foto.png'), 'png');
  fs.mkdirSync(path.join(root, 'Caixa'));
  fs.writeFileSync(path.join(root, 'Caixa', 'dentro.txt'), 'x');
  callTool('note.deletePermanent', { libraryPath: root, path: 'Quadro.canvas', origin: 'ui' });
  callTool('note.deletePermanent', { libraryPath: root, path: 'foto.png', origin: 'cli' });
  callTool('note.deletePermanent', { libraryPath: root, path: 'Caixa', origin: 'mcp' });
  callTool('note.deletePermanent', { libraryPath: root, path: 'Nota.md', origin: 'ui' });
  assert.equal(fs.existsSync(path.join(root, 'Nota.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'Quadro.canvas')), false);
  assert.equal(fs.existsSync(path.join(root, 'foto.png')), false);
  assert.equal(fs.existsSync(path.join(root, 'Caixa')), false);
  assert.equal(fs.existsSync(path.join(root, '.sophy', 'lixeira')), false);
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.match(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), /permanente/);
  assert.equal(listTrash(openLibrary(root)).length, 0);
});

test('links quebram na exclusão e voltam a resolver; .sophy fica fora do índice', () => {
  const { root } = fixture();
  fs.mkdirSync(path.join(root, '.sophy', 'lixeira', 'manual'), { recursive: true });
  fs.writeFileSync(path.join(root, '.sophy', 'escondida.md'), 'ocultaqzxpalavra no cofre\n');
  fs.writeFileSync(path.join(root, '.sophy', 'lixeira', 'manual', 'Nota.md'), 'ocultaqzxpalavra na lixeira\n');
  callTool('note.create', {
    libraryPath: root,
    path: 'Fonte.md',
    body: 'Veja [[Alvo]].\n',
    origin: 'ui',
  });
  callTool('note.create', {
    libraryPath: root,
    path: 'Alvo.md',
    body: 'palavraunicaqzx no texto.\n',
    origin: 'ui',
  });
  const before = callTool('links.outgoing', { libraryPath: root, path: 'Fonte.md' }) as Array<{
    status: string;
    path: string | null;
  }>;
  assert.equal(before[0].status, 'resolved');
  assert.equal(before[0].path, 'Alvo.md');
  callTool('entry.trash', { libraryPath: root, path: 'Alvo.md', origin: 'ui' });
  const broken = callTool('links.outgoing', { libraryPath: root, path: 'Fonte.md' }) as Array<{
    status: string;
    path: string | null;
  }>;
  assert.equal(broken[0].status, 'broken');
  assert.equal(broken[0].path, null);
  const library = openLibrary(root);
  assert.equal(listNotes(library).some((note) => note.path === 'Alvo.md' || note.path.includes('.sophy')), false);
  assert.equal(listFiles(library).some((file) => file.path.includes('.sophy')), false);
  assert.equal(listDirectories(library).some((dir) => dir === '.sophy' || dir.startsWith('.sophy/')), false);
  assert.equal(listWorkspaces(library).some((item) => item.name === '.sophy'), false);
  assert.equal(
    (callTool('search.query', { libraryPath: root, query: 'palavraunicaqzx' }) as unknown[]).length,
    0,
  );
  assert.equal(
    (callTool('search.query', { libraryPath: root, query: 'ocultaqzxpalavra' }) as unknown[]).length,
    0,
  );
  const graph = callTool('graph.query', { libraryPath: root }) as {
    nodes: Array<{ path: string }>;
    edges: Array<{ from: string; to: string }>;
  };
  assert.deepEqual(
    graph.nodes.map((node) => node.path),
    ['Fonte.md'],
  );
  assert.equal(graph.edges.length, 0);
  const id = (callTool('trash.list', { libraryPath: root }) as Array<{ id: string }>)[0].id;
  callTool('trash.restore', { libraryPath: root, id, origin: 'ui' });
  const after = callTool('links.outgoing', { libraryPath: root, path: 'Fonte.md' }) as Array<{
    status: string;
    path: string | null;
  }>;
  assert.equal(after[0].status, 'resolved');
  assert.equal(after[0].path, 'Alvo.md');
  assert.equal(
    (callTool('search.query', { libraryPath: root, query: 'palavraunicaqzx' }) as Array<{ path: string }>)[0]
      .path,
    'Alvo.md',
  );
  const restoredGraph = callTool('graph.query', { libraryPath: root }) as {
    nodes: Array<{ path: string }>;
    edges: Array<{ from: string; to: string }>;
  };
  assert.deepEqual(restoredGraph.edges, [{ from: 'Fonte.md', to: 'Alvo.md', format: 'wiki' }]);
  assert.equal(restoredGraph.nodes.some((node) => node.path.includes('.sophy')), false);
});

test('o watcher ignora .sophy e a lixeira', async () => {
  assert.equal(ignoredByWatch('.sophy/lixeira/1/Nota.md'), true);
  assert.equal(ignoredByWatch('.sophy/history.json'), true);
  assert.equal(ignoredByWatch('Estudos/.oculto/Nota.md'), true);
  assert.equal(ignoredByWatch('Estudos/Nota.md'), false);
  const { root } = fixture();
  callTool('note.create', { libraryPath: root, path: 'Nota.md', body: 'origem\n', origin: 'ui' });
  callTool('library.watch', { libraryPath: root, enabled: true });
  const before = linkGeneration(root);
  try {
    fs.writeFileSync(path.join(root, 'Visivel.md'), 'Veja [[Nota]].\n');
    const started = Date.now();
    while (linkGeneration(root) === before && Date.now() - started < 2000)
      await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(linkGeneration(root) > before);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const settled = linkGeneration(root);
    fs.mkdirSync(path.join(root, '.sophy', 'lixeira', '1700000000000-abcdabcd'), { recursive: true });
    fs.writeFileSync(path.join(root, '.sophy', 'oculta.md'), 'nao entra\n');
    fs.writeFileSync(
      path.join(root, '.sophy', 'lixeira', '1700000000000-abcdabcd', 'Nota.md'),
      'tambem nao\n',
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(linkGeneration(root), settled);
    const notes = listNotes(openLibrary(root)).map((note) => note.path);
    assert.equal(notes.includes('Visivel.md'), true);
    assert.equal(notes.some((item) => item.includes('.sophy')), false);
  } finally {
    callTool('library.watch', { libraryPath: root, enabled: false });
  }
});

test('id inválido é recusado e falha ao mover não perde o original', () => {
  const { root, library, home } = fixture();
  fs.writeFileSync(path.join(root, 'Nota.md'), 'permanece\n');
  const outside = path.join(home, 'fora.md');
  fs.writeFileSync(outside, 'segredo\n');
  fs.symlinkSync(outside, path.join(root, 'atalho.md'));
  for (const id of ['..', '../x', 'a/b', 'a\\b', '', '.', '123', '123-ZZZZZZZZ', '1700000000000-abcdabcd/../x']) {
    assert.throws(
      () => restoreTrash(library, id),
      (error: unknown) => error instanceof EngineError && error.code === 'invalid-path',
    );
  }
  assert.throws(() => callTool('trash.restore', { libraryPath: root, id: '..', origin: 'ui' }));
  assert.throws(() => callTool('trash.purge', { libraryPath: root, id: 'a/b', origin: 'ui' }));
  assert.throws(
    () => trashEntry(library, '../fora.md'),
    (error: unknown) => error instanceof EngineError && error.code === 'invalid-path',
  );
  assert.throws(
    () => trashEntry(library, 'atalho.md'),
    (error: unknown) => error instanceof EngineError && error.code === 'symlink',
  );
  assert.equal(fs.readFileSync(outside, 'utf8'), 'segredo\n');
  assert.throws(
    () => deletePermanent(library, 'atalho.md'),
    (error: unknown) => error instanceof EngineError && error.code === 'symlink',
  );
  assert.equal(fs.readFileSync(outside, 'utf8'), 'segredo\n');

  const mocked = mock.method(fs, 'renameSync', () => {
    const error = new Error('EPERM') as NodeJS.ErrnoException;
    error.code = 'EPERM';
    throw error;
  });
  try {
    assert.throws(
      () => trashEntry(library, 'Nota.md'),
      (error: unknown) => error instanceof EngineError && error.code === 'trash-failed',
    );
  } finally {
    mocked.mock.restore();
  }
  assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'permanece\n');
  const bin = path.join(root, '.sophy', 'lixeira');
  if (fs.existsSync(bin)) assert.equal(fs.readdirSync(bin).length, 0);
});

test('quando o rename cruza de disco a cópia vai para a lixeira e o original sai', () => {
  const { root, library } = fixture();
  fs.writeFileSync(path.join(root, 'Nota.md'), 'cruzou\n');
  const mocked = mock.method(fs, 'renameSync', () => {
    const error = new Error('EXDEV') as NodeJS.ErrnoException;
    error.code = 'EXDEV';
    throw error;
  });
  try {
    const moved = trashEntry(library, 'Nota.md');
    assert.equal(fs.existsSync(path.join(root, 'Nota.md')), false);
    assert.equal(fs.readFileSync(moved.trashPath, 'utf8'), 'cruzou\n');
    assert.equal(listTrash(library)[0].originalPath, 'Nota.md');
  } finally {
    mocked.mock.restore();
  }
});

test('desfazer a exclusão regrava o arquivo e tira só a cópia mais recente da lixeira', () => {
  const { root } = fixture();
  callTool('note.create', { libraryPath: root, path: 'Nota.md', body: 'versao-um\n', origin: 'ui' });
  callTool('entry.trash', { libraryPath: root, path: 'Nota.md', origin: 'ui' });
  callTool('note.create', { libraryPath: root, path: 'Nota.md', body: 'versao-dois\n', origin: 'ui' });
  callTool('entry.trash', { libraryPath: root, path: 'Nota.md', origin: 'ui' });
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.match(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), /versao-dois/);
  const left = callTool('trash.list', { libraryPath: root }) as Array<{ id: string }>;
  assert.equal(left.length, 1);
  const restored = callTool('trash.restore', {
    libraryPath: root,
    id: left[0].id,
    origin: 'ui',
  }) as { path: string };
  assert.equal(restored.path, 'Nota (restaurado).md');
  assert.match(fs.readFileSync(path.join(root, 'Nota (restaurado).md'), 'utf8'), /versao-um/);
  assert.match(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), /versao-dois/);

  fs.mkdirSync(path.join(root, 'Pacote'));
  fs.writeFileSync(path.join(root, 'Pacote', 'Dentro.md'), 'texto-pasta\n');
  callTool('entry.trash', { libraryPath: root, path: 'Pacote', origin: 'ui' });
  assert.equal(fs.existsSync(path.join(root, 'Pacote')), false);
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.match(fs.readFileSync(path.join(root, 'Pacote', 'Dentro.md'), 'utf8'), /texto-pasta/);
  assert.equal((callTool('trash.list', { libraryPath: root }) as unknown[]).length, 0);
});
