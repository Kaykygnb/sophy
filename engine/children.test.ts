import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createChildNote,
  isMother,
  listChildren,
  moveMotherTree,
  registerMother,
} from './children.ts';
import { createNote, openLibrary } from './library.ts';
import { queryGraph } from './graph.ts';
import { EngineError } from './errors.ts';

test('criar filha registra a mãe e o grafo liga child', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-filhas-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  const lib = openLibrary(root);
  createNote(lib, 'Estudos/Pai.md', '# Pai\n');
  const child = createChildNote(lib, 'Estudos/Pai.md', 'Filha');
  assert.equal(child.path, 'Estudos/Pai/Filha.md');
  assert.equal(isMother(lib, 'Estudos/Pai.md'), true);
  assert.deepEqual(listChildren(lib, 'Estudos/Pai.md'), ['Estudos/Pai/Filha.md']);
  const graph = queryGraph(lib);
  assert.ok(graph.edges.some((edge) => edge.format === 'child' && edge.to === 'Estudos/Pai/Filha.md'));
});

test('mover a mãe com falha no meio não deixa nada pela metade', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-filhas-move-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Livro'), { recursive: true });
  const lib = openLibrary(root);
  createNote(lib, 'Estudos/Pai.md', '# Pai\n');
  createChildNote(lib, 'Estudos/Pai.md', 'Filha');
  // ocupa o destino da pasta de filhas para forçar falha depois do rename da nota
  fs.mkdirSync(path.join(root, 'Livro', 'Pai'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Livro', 'Pai', 'bloqueio.txt'), 'x');
  assert.throws(() => moveMotherTree(lib, 'Estudos/Pai.md', 'Livro/Pai.md'), EngineError);
  assert.equal(fs.existsSync(path.join(root, 'Estudos', 'Pai.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'Estudos', 'Pai', 'Filha.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'Livro', 'Pai.md')), false);
  assert.equal(isMother(lib, 'Estudos/Pai.md'), true);
});

test('mover a mãe leva a pasta e atualiza o registro', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-filhas-ok-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Livro'), { recursive: true });
  const lib = openLibrary(root);
  createNote(lib, 'Estudos/Pai.md', '# Pai\n');
  createChildNote(lib, 'Estudos/Pai.md', 'Filha');
  moveMotherTree(lib, 'Estudos/Pai.md', 'Livro/Pai.md');
  assert.equal(fs.existsSync(path.join(root, 'Livro', 'Pai.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'Livro', 'Pai', 'Filha.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'Estudos', 'Pai.md')), false);
  assert.equal(isMother(lib, 'Livro/Pai.md'), true);
  assert.deepEqual(listChildren(lib, 'Livro/Pai.md'), ['Livro/Pai/Filha.md']);
});
