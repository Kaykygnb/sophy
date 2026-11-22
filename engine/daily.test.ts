import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createNote, openLibrary } from './library.ts';
import { trashEntry } from './lixeira.ts';
import { calendarFileReads, queryCalendar, todayIso } from './tasks.ts';
import { callTool } from './tools.ts';

const bin = path.resolve('engine/cli.ts');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-diario-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  return openLibrary(root);
}

function run(args: string[]) {
  const env = { ...process.env };
  delete env.SOPHY_LIBRARY;
  return spawnSync(process.execPath, ['--experimental-strip-types', bin, ...args], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env,
  });
}

test('hoje usa o fuso do computador perto da meia-noite', () => {
  const late = new Date(2026, 10, 21, 23, 30, 0);
  const early = new Date(2026, 10, 22, 0, 10, 0);
  assert.equal(todayIso(late), '2026-11-21');
  assert.equal(todayIso(early), '2026-11-22');
  if (late.getTimezoneOffset() !== 0) assert.notEqual(todayIso(late), late.toISOString().slice(0, 10));
});

test('entry.move recusa a nota do dia no app, no CLI, no MCP e na Sofi', { timeout: 30000 }, async () => {
  const opened = library();
  const daily = 'Diário/2026-11-21.md';
  createNote(opened, daily, '# Sábado\n');
  for (const origin of ['ui', 'cli', 'mcp', 'agent'] as const) {
    assert.throws(
      () => callTool('entry.move', { libraryPath: opened.root, from: daily, to: 'Estudos/Solta.md', origin }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'daily-locked' &&
        error.message === 'Notas do dia têm o nome fixo pela data',
    );
  }
  assert.equal(fs.existsSync(path.join(opened.root, 'Diário', '2026-11-21.md')), true);
  const cli = run(['mover', daily, 'Estudos/Solta.md', '--biblioteca', opened.root]);
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /daily-locked/);
  assert.match(cli.stderr, /Notas do dia têm o nome fixo pela data/);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', bin, 'mcp', '--biblioteca', opened.root, '--escrita'],
    cwd: os.tmpdir(),
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'SOPHY_LIBRARY')),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'sophy-diario', version: '0.0.0' });
  await client.connect(transport);
  try {
    const moved = await client.callTool({
      name: 'entry.move',
      arguments: { from: daily, to: 'Estudos/Solta.md' },
    });
    assert.equal(moved.isError, true);
    const text = (moved.content ?? []).map((item) => ('text' in item ? item.text : '')).join('\n');
    assert.match(text, /daily-locked/);
    assert.match(text, /Notas do dia têm o nome fixo pela data/);
  } finally {
    await client.close();
  }
});

test('criar ou renomear para um dia que já tem nota devolve daily-exists', () => {
  const opened = library();
  createNote(opened, 'Diário/2026-11-21.md', '# Dia\n');
  createNote(opened, 'Estudos/Solta.md', '# Solta\n');
  assert.throws(
    () => createNote(opened, 'Diário/2026-11-21.md', '# Outra\n'),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'daily-exists' && error.message === 'Esse dia já tem nota',
  );
  assert.throws(
    () =>
      callTool('entry.move', {
        libraryPath: opened.root,
        from: 'Estudos/Solta.md',
        to: 'Diário/2026-11-21.md',
        origin: 'ui',
      }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'daily-exists',
  );
  assert.equal(fs.existsSync(path.join(opened.root, 'Estudos', 'Solta.md')), true);
});

test('a data da nota do dia vem do nome, mesmo com data: diferente', () => {
  const opened = library();
  createNote(opened, 'Diário/2026-11-21.md', '# Dia\n', { data: '1999-01-01' });
  const calendar = queryCalendar(opened, '1999-01-01', '2026-12-31');
  const mine = calendar.items.filter((item) => item.path === 'Diário/2026-11-21.md');
  assert.deepEqual(
    mine.map((item) => item.date),
    ['2026-11-21'],
  );
  assert.equal(mine[0].kind, 'nota');
});

test('arquivo fora do padrão vira nota comum e o dia fica livre', () => {
  const opened = library();
  createNote(opened, 'Diário/2026-11-21.md', '# Dia\n', { data: '2026-11-21' });
  fs.renameSync(
    path.join(opened.root, 'Diário', '2026-11-21.md'),
    path.join(opened.root, 'Diário', 'solta.md'),
  );
  const before = queryCalendar(opened, '2026-11-01', '2026-11-30');
  assert.equal(
    before.items.some((item) => item.kind === 'nota' && item.path === 'Diário/2026-11-21.md'),
    false,
  );
  createNote(opened, 'Diário/2026-11-21.md', '# De novo\n');
  const after = queryCalendar(opened, '2026-11-01', '2026-11-30');
  const notes = after.items.filter((item) => item.kind === 'nota' && item.date === '2026-11-21');
  assert.deepEqual(notes.map((item) => item.path), ['Diário/2026-11-21.md']);
  assert.equal(fs.existsSync(path.join(opened.root, 'Diário', 'solta.md')), true);
});

test('trash.restore com o dia ocupado devolve a nota com sufixo e recria a pasta', () => {
  const opened = library();
  createNote(opened, 'Diário/2026-11-21.md', 'velha\n');
  const removed = trashEntry(opened, 'Diário/2026-11-21.md');
  createNote(opened, 'Diário/2026-11-21.md', 'nova\n');
  const restored = callTool('trash.restore', {
    libraryPath: opened.root,
    id: removed.id,
    origin: 'ui',
  }) as { path: string; restored: boolean };
  assert.equal(restored.restored, true);
  assert.match(restored.path, / \(restaurado\)\.md$/);
  assert.match(fs.readFileSync(path.join(opened.root, 'Diário', '2026-11-21.md'), 'utf8'), /nova/);
  assert.match(fs.readFileSync(path.join(opened.root, ...restored.path.split('/')), 'utf8'), /velha/);

  const other = library();
  createNote(other, 'Diário/2026-11-22.md', 'arquivo\n');
  const second = trashEntry(other, 'Diário/2026-11-22.md');
  fs.rmSync(path.join(other.root, 'Diário'), { recursive: true, force: true });
  const back = callTool('trash.restore', {
    libraryPath: other.root,
    id: second.id,
    origin: 'cli',
  }) as { path: string };
  assert.equal(back.path, 'Diário/2026-11-22.md');
  assert.match(fs.readFileSync(path.join(other.root, 'Diário', '2026-11-22.md'), 'utf8'), /arquivo/);
});

test('calendar.query não repete itens e devolve days', () => {
  const opened = library();
  createNote(opened, 'Estudos/Leitura.md', '- [ ] abrir 📅 2026-05-02 ⏳ 2026-05-02\n- [x] feita 📅 2026-05-02\n');
  createNote(opened, 'Trabalho/Reuniao.md', '- [ ] falar 📅 2026-05-02\n');
  createNote(opened, 'Diário/2026-05-02.md', '# Dia\n', { data: '2026-05-02' });
  const calendar = queryCalendar(opened, '2026-05-01', '2026-05-31');
  const leitura = calendar.items.filter((item) => item.path === 'Estudos/Leitura.md' && item.date === '2026-05-02');
  assert.equal(leitura.length, 1);
  assert.equal(leitura[0].kind, 'tarefa');
  const daily = calendar.items.filter((item) => item.path === 'Diário/2026-05-02.md');
  assert.equal(daily.length, 1);
  assert.equal(daily[0].kind, 'nota');
  const day = calendar.days.find((item) => item.date === '2026-05-02');
  assert.ok(day);
  assert.equal(day.total, 3);
  assert.equal(day.byShelf.Estudos, 1);
  assert.equal(day.byShelf.Trabalho, 1);
  assert.equal(day.byShelf.Diário, 1);
  assert.equal(day.openTasks, 2);
});

test('trocar de mês não relê notas que não mudaram', () => {
  const opened = library();
  createNote(opened, 'Estudos/A.md', '- [ ] a 📅 2026-11-02\n');
  createNote(opened, 'Estudos/B.md', '- [ ] b 📅 2026-12-02\n');
  const before = calendarFileReads(opened.root);
  queryCalendar(opened, '2026-11-01', '2026-11-30');
  const loaded = calendarFileReads(opened.root) - before;
  assert.equal(loaded, 2);
  queryCalendar(opened, '2026-12-01', '2026-12-31');
  assert.equal(calendarFileReads(opened.root) - before, loaded);
  fs.appendFileSync(path.join(opened.root, 'Estudos', 'A.md'), '\nmais\n');
  queryCalendar(opened, '2026-11-01', '2026-11-30');
  assert.equal(calendarFileReads(opened.root) - before, loaded + 1);
});
