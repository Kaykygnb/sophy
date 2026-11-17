import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createNote, openLibrary } from './library.ts';
import { listTasks, queryCalendar, updateTask } from './tasks.ts';
import { callTool } from './tools.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-tarefas-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  const opened = openLibrary(root);
  createNote(
    opened,
    'Estudos/Leitura.md',
    '# Leitura\n\n- [ ] abrir 📅 2026-11-10 ⏫\n- [/] revisar 📅 2026-11-17\n- [x] feita\n```\n- [ ] dentro do código\n```\n',
  );
  createNote(opened, 'Diário/2026-11-17.md', '---\ndata: 2026-11-17\n---\n# Hoje\n');
  return opened;
}

test('lista tarefas da biblioteca e ignora código', () => {
  const opened = library();
  const tasks = listTasks(opened, { today: '2026-11-17' });
  assert.equal(tasks.length, 3);
  assert.equal(tasks.some((task) => task.title === 'dentro do código'), false);
  const late = listTasks(opened, { due: 'atrasada', today: '2026-11-17' });
  assert.deepEqual(
    late.map((task) => task.title),
    ['abrir'],
  );
  const shelf = listTasks(opened, { workspace: 'Estudos', priority: 'alta' });
  assert.equal(shelf.length, 1);
  assert.equal(shelf[0].status, 'aberta');
});

test('atualizar status e prazo reescreve a linha e entra no calendário', () => {
  const opened = library();
  const task = listTasks(opened).find((item) => item.title === 'abrir');
  assert.ok(task);
  const updated = updateTask(opened, task.path, task.line, { status: 'feita', due: '2026-11-20' }, task.revision);
  assert.equal(updated.conflict, false);
  if (updated.conflict) return;
  assert.equal(updated.task?.status, 'feita');
  assert.equal(updated.task?.due, '2026-11-20');
  const text = fs.readFileSync(path.join(opened.root, 'Estudos', 'Leitura.md'), 'utf8');
  assert.match(text, /- \[x\] abrir 📅 2026-11-20 ⏫/);
  const days = queryCalendar(opened, '2026-11-01', '2026-11-30');
  assert.equal(days.some((item) => item.kind === 'nota' && item.date === '2026-11-17'), true);
  assert.equal(days.some((item) => item.kind === 'frontmatter' && item.field === 'data'), true);
  assert.equal(days.some((item) => item.kind === 'tarefa' && item.date === '2026-11-20'), true);
});

test('a tool task.query força a biblioteca da sessão', () => {
  const opened = library();
  const listed = callTool('task.query', {
    libraryPath: opened.root,
    today: '2026-11-17',
    due: 'hoje',
  }) as Array<{ title: string }>;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, 'revisar');
});
