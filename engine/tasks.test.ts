import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { calendarSeeds, dateOf } from './calendar-facts.ts';
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
  const calendar = queryCalendar(opened, '2026-11-01', '2026-11-30');
  const days = calendar.items;
  assert.equal(days.some((item) => item.kind === 'nota' && item.date === '2026-11-17'), true);
  assert.equal(
    days.some((item) => item.kind === 'frontmatter' && item.field === 'data' && item.path.startsWith('Diário/')),
    false,
  );
  assert.equal(days.some((item) => item.kind === 'tarefa' && item.date === '2026-11-20'), true);
  const day = calendar.days.find((item) => item.date === '2026-11-17');
  assert.ok(day);
  assert.equal(day.total, 2);
});

function libraryWith(body: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-tarefas-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  const opened = openLibrary(root);
  createNote(opened, 'Estudos/T.md', body);
  return opened;
}

test('pula tarefa sem título depois das marcações', () => {
  const body = [
    '- [ ]',
    '- [ ] ',
    '- [ ]   ',
    '- [ ]\t',
    '- [ ] ⏫',
    '- [ ] 🔼',
    '- [ ] 🔽',
    '- [ ] ⏫\uFE0F',
    '- [ ] 📅 2026-11-01',
    '- [ ] ⏳ 2026-11-02',
    '- [ ] 🛫 2026-11-03',
    '- [ ] ✅ 2026-11-04',
    '- [ ] <span data-fundo="marrom"></span>',
    '- [ ] <span data-cor="azul"> </span>',
    '- [ ] <span data-fundo="marrom">📅 2026-11-22</span>',
    '- [ ] <span data-cor="vermelho"></span> ⏫',
    '- [ ] <span data-cor="azul">⏫</span>',
    '- [ ] 📅 <span data-fundo="marrom">2026-11-22</span>',
    '- [ ] ⏳ <span data-cor="azul">2026-11-23</span>',
    '- [x]',
    '- [/] ',
    '- [-] ⏫',
    '* [ ]',
    '1. [ ]',
    '- [ ] pai',
    '  - [ ]',
    '  - [ ] ⏫',
    '  - [ ] filho',
    '- [ ] pagar boleto ⏫',
    '- [ ] <span data-cor="vermelho">revisar</span>',
    '- [ ] ler 📅 2026-11-22',
    '- [ ] pagar <span data-cor="azul">boleto</span> urgente',
    '- [ ] <span data-fundo="marrom">2026-11-30</span>',
    '* [ ] estrela',
    '1. [ ] item',
    '- [x] feita de verdade',
    '```',
    '- [ ] dentro do código',
    '```',
  ].join('\n');
  const tasks = listTasks(libraryWith(body));
  assert.deepEqual(
    tasks.map((task) => task.title),
    [
      'pai',
      'filho',
      'pagar boleto',
      '<span data-cor="vermelho">revisar</span>',
      'ler',
      'pagar <span data-cor="azul">boleto</span> urgente',
      '<span data-fundo="marrom">2026-11-30</span>',
      'estrela',
      'item',
      'feita de verdade',
    ],
  );
  const pai = tasks.find((task) => task.title === 'pai');
  const filho = tasks.find((task) => task.title === 'filho');
  assert.ok(pai && filho);
  assert.equal(pai.childTotal, 1);
  assert.equal(pai.childDone, 0);
  assert.equal(filho.parentLine, pai.line);
  assert.equal(tasks.some((task) => task.title.trim() === ''), false);
  assert.equal(tasks.some((task) => task.title === 'dentro do código'), false);
  const pagar = tasks.find((task) => task.title === 'pagar boleto');
  const ler = tasks.find((task) => task.title === 'ler');
  assert.equal(pagar?.priority, 'alta');
  assert.equal(ler?.due, '2026-11-22');
});

test('lê prazo e agendamento com a data dentro do span', () => {
  assert.equal(dateOf('📅 2026-11-22', '📅'), '2026-11-22');
  assert.equal(dateOf('📅2026-11-22', '📅'), '2026-11-22');
  assert.equal(dateOf('⏳ 2026-11-23', '⏳'), '2026-11-23');
  assert.equal(dateOf('🛫2026-11-09', '🛫'), '2026-11-09');
  assert.equal(dateOf('📅\uFE0F 2026-11-13', '📅'), '2026-11-13');
  assert.equal(dateOf('sem data', '📅'), null);
  assert.equal(dateOf('📅 ⏳ 2026-11-22', '📅'), null);
  assert.equal(dateOf('📅 <span data-fundo="marrom">2026-11-22</span>', '📅'), '2026-11-22');
  assert.equal(dateOf('⏳ <span data-cor="azul">2026-11-23</span>', '⏳'), '2026-11-23');
  assert.equal(dateOf('📅 <span data-fundo="marrom">amanhã</span>', '📅'), null);

  const body = [
    '- [ ] boleto 📅 <span data-fundo="marrom">2026-11-22</span> ⏫',
    '- [ ] estudar ⏳ <span data-cor="azul">2026-11-23</span>',
    '- [ ] ambos 📅 <span data-cor="azul" data-fundo="marrom">2026-11-24</span> ⏳ <span data-fundo="verde">2026-11-25</span>',
    '- [ ] inicio 🛫 <span data-fundo="amarelo">2026-11-26</span>',
    '- [ ] clássico 📅 2026-11-10 ⏳ 2026-11-11 🛫 2026-11-09',
    '- [ ] junto 📅2026-11-12',
    '- [ ] variante 📅\uFE0F 2026-11-13',
    '- [ ] span e variante 📅\uFE0F <span data-fundo="marrom">2026-11-14</span>',
    '- [ ] cor 📅 <span data-cor="vermelho">2026-11-15</span>',
    "- [ ] aspas 📅 <span data-fundo='marrom'>2026-11-16</span>",
    '- [ ] folga 📅   <span data-fundo="marrom">  2026-11-17</span>',
    '- [ ] emoji no span <span data-fundo="marrom">📅 2026-11-18</span>',
    '- [ ] aninhado 📅 <span data-fundo="marrom"><span data-cor="azul">2026-11-19</span></span>',
    '- [ ] ordem 📅 <span data-fundo="marrom" data-cor="azul">2026-11-20</span>',
    '- [ ] lembrar 📅 <span data-fundo="marrom">amanhã</span>',
    '- [ ] sem data',
    '- [ ] colorido <span data-cor="azul">pagar</span> 📅 <span data-fundo="marrom">2026-11-27</span>',
    '- [ ] 📅 <span data-fundo="marrom">2026-11-28</span>',
    '```',
    '- [ ] segredo 📅 <span data-fundo="marrom">2026-11-29</span>',
    '```',
  ].join('\n');
  const opened = libraryWith(body);
  const tasks = listTasks(opened, { today: '2026-11-22' });
  const byTitle = new Map(tasks.map((task) => [task.title, task]));

  assert.equal(byTitle.get('boleto')?.due, '2026-11-22');
  assert.equal(byTitle.get('boleto')?.scheduled, null);
  assert.equal(byTitle.get('boleto')?.priority, 'alta');
  assert.equal(byTitle.get('estudar')?.due, null);
  assert.equal(byTitle.get('estudar')?.scheduled, '2026-11-23');
  assert.equal(byTitle.get('ambos')?.due, '2026-11-24');
  assert.equal(byTitle.get('ambos')?.scheduled, '2026-11-25');
  assert.equal(byTitle.get('inicio')?.start, '2026-11-26');
  assert.equal(byTitle.get('inicio')?.due, null);
  assert.equal(byTitle.get('clássico')?.due, '2026-11-10');
  assert.equal(byTitle.get('clássico')?.scheduled, '2026-11-11');
  assert.equal(byTitle.get('clássico')?.start, '2026-11-09');
  assert.equal(byTitle.get('junto')?.due, '2026-11-12');
  assert.equal(byTitle.get('variante')?.due, '2026-11-13');
  assert.equal(byTitle.get('span e variante')?.due, '2026-11-14');
  assert.equal(byTitle.get('cor')?.due, '2026-11-15');
  assert.equal(byTitle.get('aspas')?.due, '2026-11-16');
  assert.equal(byTitle.get('folga')?.due, '2026-11-17');
  assert.equal(byTitle.get('emoji no span <span data-fundo="marrom">')?.due, '2026-11-18');
  assert.equal(byTitle.get('aninhado')?.due, '2026-11-19');
  assert.equal(byTitle.get('ordem')?.due, '2026-11-20');
  assert.equal(byTitle.get('lembrar')?.due, null);
  assert.equal(byTitle.get('sem data')?.due, null);
  assert.equal(byTitle.get('sem data')?.scheduled, null);
  assert.equal(
    byTitle.get('colorido <span data-cor="azul">pagar</span>')?.due,
    '2026-11-27',
  );
  assert.equal(tasks.some((task) => task.due === '2026-11-28'), false);
  assert.equal(tasks.some((task) => task.due === '2026-11-29'), false);
  assert.deepEqual(
    listTasks(opened, { due: 'hoje', today: '2026-11-22' }).map((task) => task.title),
    ['boleto'],
  );

  const seeds = calendarSeeds('Estudos/T.md', body, 'T');
  const seed = (date: string, title: string) =>
    seeds.find((item) => item.kind === 'tarefa' && item.date === date && item.title === title);
  assert.equal(seed('2026-11-22', 'boleto')?.status, 'aberta');
  assert.ok(seed('2026-11-23', 'estudar'));
  assert.ok(seed('2026-11-24', 'ambos'));
  assert.ok(seed('2026-11-25', 'ambos'));
  assert.ok(seed('2026-11-10', 'clássico'));
  assert.ok(seed('2026-11-11', 'clássico'));
  assert.equal(seeds.some((item) => item.date === '2026-11-09'), false);
  assert.ok(seed('2026-11-12', 'junto'));
  assert.ok(seed('2026-11-13', 'variante'));
  assert.ok(seed('2026-11-14', 'span e variante'));
  assert.ok(seed('2026-11-18', 'emoji no span <span data-fundo="marrom">'));
  assert.ok(seed('2026-11-27', 'colorido <span data-cor="azul">pagar</span>'));
  assert.ok(seed('2026-11-28', ''));
  assert.equal(seeds.some((item) => item.date === '2026-11-29'), false);

  const calendar = queryCalendar(opened, '2026-11-01', '2026-11-30');
  assert.equal(
    calendar.items.some((item) => item.kind === 'tarefa' && item.date === '2026-11-22' && item.title === 'boleto'),
    true,
  );
  assert.equal(
    calendar.items.some((item) => item.kind === 'tarefa' && item.date === '2026-11-29'),
    false,
  );
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
