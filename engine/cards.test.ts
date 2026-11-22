import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EngineError } from './errors.ts';
import { createNote, moveEntry, openLibrary } from './library.ts';
import { intervalLabel, listCards, nextInterval, reviewCard, undoCard } from './study.ts';
import { callTool } from './tools.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-cartas-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  return openLibrary(root);
}

test('as quatro notas seguem a tabela e knew continua valendo 3 ou 1', () => {
  const opened = library();
  createNote(opened, 'Estudos/Cartas.md', 'capital :: Brasília\n');
  const [card] = listCards(opened, '2026-11-17');
  assert.deepEqual(card.intervals, { 1: '1d', 2: '1d', 3: '1d', 4: '3d' });
  assert.equal(card.interval, 0);
  assert.equal(card.ease, 2.5);

  const easy = reviewCard(opened, card.id, 4, '2026-11-17');
  assert.equal(easy.interval, 3.25);
  assert.equal(easy.ease, 2.65);
  assert.equal(easy.lapses, 0);
  assert.equal(easy.due, '2026-11-20');

  const missed = reviewCard(opened, card.id, 1, '2026-11-20');
  assert.equal(missed.interval, 1);
  assert.equal(missed.lapses, 1);
  assert.equal(missed.ease, 2.45);
  assert.equal(missed.due, '2026-11-21');

  const hard = reviewCard(opened, card.id, 2, '2026-11-21');
  assert.equal(hard.interval, 1.2);
  assert.equal(hard.ease, 2.3);

  const fresh = library();
  createNote(fresh, 'Estudos/Outra.md', 'água :: H2O\n');
  const [other] = listCards(fresh, '2026-11-17');
  const good = reviewCard(fresh, other.id, true, '2026-11-17');
  assert.equal(good.interval, 1);
  assert.equal(good.due, '2026-11-18');
  const second = reviewCard(fresh, other.id, 3, '2026-11-18');
  assert.equal(second.interval, 3);
  assert.equal(second.due, '2026-11-21');
  const later = nextInterval({ due: second.due, interval: 6, ease: 2.5, lapses: 0 }, 3);
  assert.equal(later.interval, 15);
  assert.equal(intervalLabel(later.interval), '2sem');

  const fail = reviewCard(fresh, other.id, false, '2026-11-21');
  assert.equal(fail.interval, 1);
  assert.equal(fail.lapses, 1);
  assert.equal(fail.ease, 2.3);
  assert.throws(
    () => reviewCard(fresh, other.id, 5, '2026-11-21'),
    (error: unknown) => error instanceof EngineError && /inteiro de 1 a 4/.test(error.message),
  );
});

test('o id sobrevive a renomear, o texto repetido ganha contador e o agendamento antigo migra uma vez', () => {
  const opened = library();
  createNote(opened, 'Estudos/Cartas.md', 'um :: a\num :: b\n\ndois :: c\n');
  const before = listCards(opened, '2026-11-17');
  assert.equal(before.length, 3);
  assert.equal(before[1].id, `${before[0].id}_2`);
  assert.notEqual(before[2].id, before[0].id);
  const reviewed = reviewCard(opened, before[2].id, 3, '2026-11-17');
  moveEntry(opened, 'Estudos/Cartas.md', 'Estudos/Renomeada.md');
  const after = listCards(opened, '2026-11-18');
  const moved = after.find((card) => card.front === 'dois');
  assert.equal(moved?.id, reviewed.id);
  assert.equal(moved?.path, 'Estudos/Renomeada.md');
  assert.equal(moved?.due, reviewed.due);

  const legacy = library();
  const relative = 'Estudos/Velha.md';
  fs.writeFileSync(path.join(legacy.root, 'Estudos', 'Velha.md'), 'alpha :: 1\n\nbeta :: 2\n');
  const deck = {
    cards: {
      'Estudos\\Velha.md:1': { due: '2026-12-01', box: 2 },
      'Estudos/Velha.md:3': { due: '2027-01-15', box: 0 },
      'Estudos/Velha.md:9': { due: '2028-01-01', box: 1 },
    },
  };
  fs.mkdirSync(path.join(legacy.root, '.sophy'), { recursive: true });
  fs.writeFileSync(path.join(legacy.root, '.sophy', 'flashcards.json'), JSON.stringify(deck));
  const migrated = listCards(legacy, '2026-11-17');
  assert.equal(migrated[0].front, 'alpha');
  assert.equal(migrated[0].due, '2026-12-01');
  assert.equal(migrated[0].interval, 4);
  assert.equal(migrated[0].ease, 2.5);
  assert.equal(migrated[1].due, '2027-01-15');
  assert.equal(migrated[1].interval, 1);
  assert.equal(migrated[1].lapses, 1);
  const stored = JSON.parse(fs.readFileSync(path.join(legacy.root, '.sophy', 'flashcards.json'), 'utf8')) as {
    cardIdsMigrated: boolean;
    cards: Record<string, { due: string }>;
  };
  assert.equal(stored.cardIdsMigrated, true);
  assert.equal(stored.cards['Estudos/Velha.md:1'], undefined);
  assert.equal(stored.cards['Estudos/Velha.md:9'].due, '2028-01-01');
  fs.writeFileSync(path.join(legacy.root, 'Estudos', 'Velha.md'), 'beta :: 2\n\nalpha :: 1\n');
  const swapped = listCards(legacy, '2026-11-17');
  assert.equal(swapped.find((card) => card.front === 'alpha')?.due, '2026-12-01');
  assert.equal(swapped.find((card) => card.front === 'beta')?.due, '2027-01-15');
  assert.equal(relative.endsWith('.md'), true);
});

test('card.undo restaura um nível e passa por tracked', () => {
  const opened = library();
  createNote(opened, 'Estudos/Cartas.md', 'capital :: Brasília\n');
  const [card] = listCards(opened, '2026-11-17');
  assert.throws(
    () => undoCard(opened, card.id),
    (error: unknown) =>
      error instanceof EngineError && error.message === 'Não há revisão anterior deste cartão para desfazer.',
  );
  reviewCard(opened, card.id, 3, '2026-11-17');
  reviewCard(opened, card.id, 1, '2026-11-18');
  const undone = callTool('card.undo', { libraryPath: opened.root, id: card.id, origin: 'agent' }) as {
    interval: number;
    lapses: number;
    due: string;
  };
  assert.equal(undone.interval, 1);
  assert.equal(undone.lapses, 0);
  assert.equal(undone.due, '2026-11-18');
  const points = fs.readdirSync(path.join(opened.root, '.sophy', 'versoes'));
  const label = JSON.parse(
    fs.readFileSync(path.join(opened.root, '.sophy', 'versoes', points[0], 'ponto.json'), 'utf8'),
  ) as { label: string };
  assert.equal(label.label, 'agent:card.undo');
  assert.throws(
    () => callTool('card.undo', { libraryPath: opened.root, id: card.id, origin: 'ui' }),
    /Não há revisão anterior/,
  );
});
