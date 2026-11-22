import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createNote, openLibrary, readNote, writeNote } from './library.ts';
import { relocate } from './links.ts';
import { noteIdOf, readNoteIdIndex } from './note-id.ts';
import { splitMarkdown } from './markdown.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-id-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  return openLibrary(root);
}

test('renomear 10 vezes mantém o mesmo id', () => {
  const lib = library();
  let note = createNote(lib, 'Estudos/A.md', '# A\n');
  const id = noteIdOf(note.frontmatter);
  assert.ok(id);
  let current = 'Estudos/A.md';
  for (let index = 0; index < 10; index += 1) {
    const next = `Estudos/A${index}.md`;
    relocate(lib, current, next);
    current = next;
    note = readNote(lib, current);
    assert.equal(noteIdOf(note.frontmatter), id);
  }
  assert.equal(readNoteIdIndex(lib)[id!].path, current);
});

test('apagar o id fora do app restaura o mesmo', () => {
  const lib = library();
  const note = createNote(lib, 'Estudos/B.md', '# B\n');
  const id = noteIdOf(note.frontmatter)!;
  const full = path.join(lib.root, 'Estudos', 'B.md');
  fs.writeFileSync(full, '# B\n\nSem id.\n');
  const restored = readNote(lib, 'Estudos/B.md');
  assert.equal(noteIdOf(restored.frontmatter), id);
  assert.match(fs.readFileSync(full, 'utf8'), new RegExp(`id: ${id}`));
  assert.match(restored.body, /Sem id/);
});

test('cópia com o mesmo id ganha id novo', () => {
  const lib = library();
  const note = createNote(lib, 'Estudos/C.md', '# C\n');
  const id = noteIdOf(note.frontmatter)!;
  const original = fs.readFileSync(path.join(lib.root, 'Estudos', 'C.md'), 'utf8');
  fs.writeFileSync(path.join(lib.root, 'Estudos', 'C-copia.md'), original);
  // deixa a cópia parecer mais nova
  const copyPath = path.join(lib.root, 'Estudos', 'C-copia.md');
  const now = Date.now() + 2000;
  fs.utimesSync(copyPath, now / 1000, now / 1000);
  const originalNote = readNote(lib, 'Estudos/C.md');
  const copyNote = readNote(lib, 'Estudos/C-copia.md');
  assert.equal(noteIdOf(originalNote.frontmatter), id);
  assert.notEqual(noteIdOf(copyNote.frontmatter), id);
  assert.ok(noteIdOf(copyNote.frontmatter));
});

test('notas antigas sem id recebem um sem perder conteúdo', () => {
  const lib = library();
  const full = path.join(lib.root, 'Estudos', 'Antiga.md');
  fs.writeFileSync(full, '# Antiga\n\nCorpo preservado [[x]].\n');
  const note = readNote(lib, 'Estudos/Antiga.md');
  assert.ok(noteIdOf(note.frontmatter));
  assert.equal(note.body.includes('Corpo preservado [[x]].'), true);
  assert.equal(splitMarkdown(fs.readFileSync(full, 'utf8')).body.includes('Corpo preservado [[x]].'), true);
});

test('writeNote sem id no patch preserva o id existente', () => {
  const lib = library();
  const note = createNote(lib, 'Estudos/D.md', '# D\n', { tags: ['a'] });
  const id = noteIdOf(note.frontmatter)!;
  const result = writeNote(lib, 'Estudos/D.md', {
    body: '# D\n\nNovo.\n',
    frontmatter: { tags: ['a', 'b'] },
    expectedRevision: note.revision,
  });
  assert.equal(result.conflict, false);
  if (!result.conflict) assert.equal(noteIdOf(result.note.frontmatter), id);
});
