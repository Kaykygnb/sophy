import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createdAtFrom, createNote, formatCreatedStamp, openLibrary, readNote, writeNote } from './library.ts';
import { splitMarkdown } from './markdown.ts';
import { callTool } from './tools.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-criada-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  return openLibrary(root);
}

function topKeys(file: string) {
  const raw = fs.readFileSync(file, 'utf8');
  const block = raw.split(/^---\r?\n/)[1]?.split(/\r?\n---/)[0] ?? '';
  return [...block.matchAll(/^([A-Za-z0-9_]+):/gm)].map((match) => match[1]);
}

test('criar grava criada junto do id sem reordenar os campos de quem pediu', () => {
  const opened = library();
  const note = createNote(opened, 'Estudos/Ordem.md', 'corpo [[\n', {
    zebra: 1,
    tags: ['a'],
    titulo: 'Oi',
  });
  const file = path.join(opened.root, 'Estudos', 'Ordem.md');
  assert.deepEqual(topKeys(file), ['zebra', 'tags', 'titulo', 'id', 'criada']);
  assert.match(String(note.frontmatter?.criada), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(note.frontmatter?.criada, formatCreatedStamp(new Date(String(note.frontmatter?.criada))));
  const kept = createNote(opened, 'Estudos/Marcada.md', 'oi\n', {
    criada: '1999-05-04T06:07:08',
    zebra: 'z',
  });
  assert.equal(kept.frontmatter?.criada, '1999-05-04T06:07:08');
  const before = fs.readFileSync(file, 'utf8');
  const written = writeNote(opened, 'Estudos/Ordem.md', {
    body: 'corpo novo\n',
    expectedRevision: readNote(opened, 'Estudos/Ordem.md').revision,
  });
  assert.equal(written.conflict, false);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(splitMarkdown(after).prefix, splitMarkdown(before).prefix);
  assert.match(after, /corpo novo/);
});

test('nota antiga não ganha criada e o grafo filtra por createdAt', () => {
  assert.equal(
    createdAtFrom({ criada: '2020-01-01T08:00:00' }, { birthtimeMs: 10, mtimeMs: 20 }),
    '2020-01-01T08:00:00',
  );
  assert.equal(createdAtFrom(null, { birthtimeMs: 0, mtimeMs: Date.UTC(2019, 0, 2, 15, 4, 5) }), formatCreatedStamp(new Date(Date.UTC(2019, 0, 2, 15, 4, 5))));
  const birth = Date.UTC(2018, 3, 4, 1, 2, 3);
  assert.equal(
    createdAtFrom({ criada: 'não é data' }, { birthtimeMs: birth, mtimeMs: 1 }),
    formatCreatedStamp(new Date(birth)),
  );

  const opened = library();
  const oldFile = path.join(opened.root, 'Estudos', 'Antiga.md');
  fs.writeFileSync(oldFile, '---\nzebra: 1\ntitulo: Oi\n---\nAntiga\n');
  const read = readNote(opened, 'Estudos/Antiga.md');
  assert.equal(read.frontmatter?.criada, undefined);
  assert.equal(topKeys(oldFile)[0], 'id');
  assert.deepEqual(topKeys(oldFile).slice(1), ['zebra', 'titulo']);

  fs.writeFileSync(
    path.join(opened.root, 'Estudos', 'Velha.md'),
    '---\nid: velha\ncriada: "2020-01-01T08:00:00"\nzebra: 1\n---\nVelha\n',
  );
  fs.writeFileSync(
    path.join(opened.root, 'Estudos', 'Nova.md'),
    '---\nid: nova\ncriada: "2024-06-15T12:00:00"\n---\nNova\n',
  );
  const all = callTool('graph.query', { libraryPath: opened.root, workspace: 'Estudos' }) as {
    nodes: Array<{ path: string; createdAt: string; modifiedAt: number }>;
  };
  const byPath = Object.fromEntries(all.nodes.map((node) => [node.path, node]));
  assert.equal(byPath['Estudos/Velha.md'].createdAt, '2020-01-01T08:00:00');
  assert.equal(byPath['Estudos/Nova.md'].createdAt, '2024-06-15T12:00:00');
  assert.match(byPath['Estudos/Antiga.md'].createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(typeof byPath['Estudos/Nova.md'].modifiedAt, 'number');

  const year = callTool('graph.query', {
    libraryPath: opened.root,
    from: '2024-01-01',
    to: '2024-12-31',
  }) as { nodes: Array<{ path: string }> };
  assert.deepEqual(
    year.nodes.map((node) => node.path).sort(),
    ['Estudos/Nova.md'],
  );
  const morning = callTool('graph.query', {
    libraryPath: opened.root,
    to: '2020-01-01T07:00:00',
  }) as { nodes: Array<{ path: string }> };
  assert.equal(
    morning.nodes.some((node) => node.path === 'Estudos/Velha.md'),
    false,
  );
  const day = callTool('graph.query', {
    libraryPath: opened.root,
    from: '2020-01-01',
    to: '2020-01-01',
  }) as { nodes: Array<{ path: string }> };
  assert.equal(
    day.nodes.some((node) => node.path === 'Estudos/Velha.md'),
    true,
  );
  assert.throws(() => callTool('graph.query', { libraryPath: opened.root, from: 'ontem' }), /Data inválida/);
});
