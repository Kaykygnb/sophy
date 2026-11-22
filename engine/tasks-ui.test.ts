import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createNote, openLibrary, writeNote } from './library.ts';
import { listTasks, rewriteTaskLine, updateTask } from './tasks.ts';

test('emoji de prioridade com e sem variante UTF-8', () => {
  const withVariant = rewriteTaskLine('- [ ] Pagar', { priority: 'alta' });
  assert.match(withVariant, /⏫/);
  const libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-task-emoji-'));
  fs.mkdirSync(path.join(libRoot, 'Estudos'), { recursive: true });
  const lib = openLibrary(libRoot);
  createNote(lib, 'Estudos/T.md', `# T\n\n- [ ] A ⏫\n- [ ] B ⏫️\n`);
  const rows = listTasks(lib);
  assert.equal(rows.filter((task) => task.priority === 'alta').length, 2);
});

test('foco grava agendamento e subtarefas contam filhos', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-task-focus-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  const lib = openLibrary(root);
  const note = createNote(
    lib,
    'Estudos/T.md',
    `# T\n\n- [ ] Mãe\n  - [ ] filha 1\n  - [x] filha 2\n- [ ] Sozinha 📅 2026-11-20\n`,
  );
  const rows = listTasks(lib);
  const mother = rows.find((task) => task.title === 'Mãe');
  assert.equal(mother?.childTotal, 2);
  assert.equal(mother?.childDone, 1);
  const alone = rows.find((task) => task.title === 'Sozinha');
  const updated = updateTask(
    lib,
    'Estudos/T.md',
    alone!.line,
    { scheduled: '2026-11-22' },
    alone!.revision,
  );
  assert.equal(updated.conflict, false);
  if (!updated.conflict) assert.equal(updated.task?.scheduled, '2026-11-22');
});

test('conflito de revisão com título único recupera a linha', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-task-conflict-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  const lib = openLibrary(root);
  const note = createNote(lib, 'Estudos/T.md', `# T\n\n- [ ] Unica\n- [ ] Outra\n`);
  const rows = listTasks(lib);
  const task = rows.find((item) => item.title === 'Unica')!;
  writeNote(lib, 'Estudos/T.md', {
    body: `# T\n\ntexto\n\n- [ ] Unica\n- [ ] Outra\n`,
    expectedRevision: note.revision,
  });
  const result = updateTask(
    lib,
    'Estudos/T.md',
    task.line,
    { status: 'feita' },
    task.revision,
    { titleHint: 'Unica' },
  );
  assert.equal(result.conflict, false);
  if (!result.conflict) assert.equal(result.task?.status, 'feita');
});
