import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

function directoryBytes(directory: string) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    total += entry.isDirectory() ? directoryBytes(full) : fs.statSync(full).size;
  }
  return total;
}
import { createNote, openLibrary } from './library.ts';
import {
  enableSemantic,
  exportSite,
  lightPaperHtml,
  listCards,
  restoreVersion,
  reviewCard,
  saveVersionPoint,
  semanticSearch,
  weeklyReview,
} from './study.ts';

test('cartão ignora código, a revisão espaça e o índice só existe ligado', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-estudo-'));
  const library = openLibrary(root);
  createNote(library, 'Estudos/Cartas.md', 'capital :: Brasília\nágua ::: 100 °C\n```\nfalso :: não\n```\n');
  const cards = listCards(library, '2026-11-17');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].front, 'capital');
  assert.equal(cards[1].reversible, true);
  assert.equal(cards[1].back, '100 °C');
  const reviewed = reviewCard(library, cards[0].id, true, '2026-11-17');
  assert.equal(reviewed.interval, 1);
  assert.equal(reviewed.ease, 2.5);
  assert.equal(reviewed.due, '2026-11-18');
  assert.equal(cards[0].id.startsWith('c_'), true);
  assert.equal(semanticSearch(library, 'capital').enabled, false);
  assert.equal(fs.existsSync(path.join(root, '.sophy', 'busca.json')), false);
  enableSemantic(library);
  assert.equal(semanticSearch(library, 'Brasília').hits[0].path, 'Estudos/Cartas.md');
});

test('versão apaga a mais antiga, o site não entra na biblioteca e o aviso é só no domingo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-versao-'));
  const library = openLibrary(root);
  createNote(library, 'Diário/nota.md', '# Nota\n\num parágrafo longo o bastante\n');
  saveVersionPoint(library, 'antiga', { now: new Date('2026-01-01T12:00:00Z'), maxBytes: 1024 * 1024 * 1024 });
  const versions = path.join(root, '.sophy', 'versoes');
  const firstSize = fs.statSync(path.join(versions, fs.readdirSync(versions)[0])).isDirectory()
    ? directoryBytes(path.join(versions, fs.readdirSync(versions)[0]))
    : 0;
  const second = saveVersionPoint(library, 'nova', {
    now: new Date('2026-11-17T12:00:00Z'),
    maxBytes: firstSize * 2 - 1,
  });
  assert.equal(second.removed.length > 0, true);
  const left = fs.readdirSync(versions);
  assert.equal(left.length, 1);
  assert.equal(left[0].startsWith('2026-11-17'), true);

  const agedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-idade-'));
  const agedLibrary = openLibrary(agedRoot);
  createNote(agedLibrary, 'Diário/nota.md', '# Nota\n');
  saveVersionPoint(agedLibrary, 'velha', {
    now: new Date('2026-01-01T12:00:00Z'),
    maxAgeMs: 24 * 60 * 60 * 1000,
    maxBytes: 1024 * 1024 * 1024,
  });
  saveVersionPoint(agedLibrary, 'hoje', {
    now: new Date('2026-11-17T12:00:00Z'),
    maxAgeMs: 24 * 60 * 60 * 1000,
    maxBytes: 1024 * 1024 * 1024,
  });
  const names = fs.readdirSync(path.join(agedRoot, '.sophy', 'versoes'));
  assert.equal(names.some((name) => name.startsWith('2026-01-01')), false);
  assert.equal(names.some((name) => name.startsWith('2026-11-17')), true);
  fs.writeFileSync(path.join(agedRoot, 'Diário/nota.md'), '# Mudou\n');
  restoreVersion(agedLibrary, names.find((name) => name.startsWith('2026-11-17')));
  assert.match(fs.readFileSync(path.join(agedRoot, 'Diário/nota.md'), 'utf8'), /# Nota/);

  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-site-'));
  const before = fs.readFileSync(path.join(root, 'Diário/nota.md'));
  const exported = exportSite(library, site, 'dark');
  assert.equal(exported.pages, 1);
  assert.match(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), /data-theme="dark"/);
  assert.equal(fs.readFileSync(path.join(root, 'Diário/nota.md')).equals(before), true);
  assert.match(lightPaperHtml('Nota', 'texto'), /data-theme="light"/);
  assert.match(lightPaperHtml('Nota', 'texto'), /background: #fff/);

  const sunday = weeklyReview(new Date('2026-11-15T12:00:00'), 1);
  const tuesday = weeklyReview(new Date('2026-11-17T12:00:00'), 1);
  assert.equal(sunday.notice, true);
  assert.equal(tuesday.notice, false);
  assert.equal(tuesday.from, '2026-11-16');
  assert.equal(tuesday.to, '2026-11-22');
});
