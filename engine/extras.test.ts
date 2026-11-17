import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fillTemplate, importVault, linkMentions, listViews, saveView, unlinkedMentions } from './extras.ts';
import { createNote, openLibrary } from './library.ts';
import { callTool } from './tools.ts';

test('o modelo troca data, título, hora e tira o cursor', () => {
  const filled = fillTemplate('# {{titulo}}\n\n{{data}} {{hora}}\n\n{{cursor}}fim', {
    data: '2026-11-17',
    titulo: 'Reunião',
    hora: '08:30',
  });
  assert.equal(filled.body.includes('{{'), false);
  assert.match(filled.body, /Reunião/);
  assert.match(filled.body, /2026-11-17 08:30/);
  assert.equal(filled.body.endsWith('fim'), true);
});

test('ligar menções escreve wikilinks e a importação não mexe na origem', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-extras-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-vault-'));
  const library = openLibrary(root);
  createNote(library, 'Estudos/Leitura.md', '# Leitura\n');
  createNote(library, 'Estudos/Resumo.md', 'A Leitura ficou de fora do colchete. 2026-11-17\n');
  createNote(library, 'Diário/2026-11-17.md', '# dia\n');
  createNote(library, 'Estudos/Oi.md', 'Oi\n');
  createNote(library, 'Estudos/Capa.md', 'Uma capa.\n');
  const found = unlinkedMentions(library);
  assert.equal(found.some((row) => row.title === 'Leitura' && row.total === 1), true);
  assert.equal(found.some((row) => row.title === '2026-11-17'), false);
  assert.equal(found.some((row) => row.title === 'Capa'), false);
  const linked = linkMentions(library, 'Leitura');
  assert.equal(linked.links, 1);
  assert.match(fs.readFileSync(path.join(root, 'Estudos/Resumo.md'), 'utf8'), /\[\[Leitura\]\]/);

  fs.mkdirSync(path.join(source, 'Notas'));
  fs.writeFileSync(path.join(source, 'Notas/Pagina.md'), '# Pagina\n', 'utf8');
  fs.mkdirSync(path.join(source, '.obsidian'));
  fs.writeFileSync(path.join(source, '.obsidian', 'app.json'), '{}');
  const stamp = fs.readFileSync(path.join(source, 'Notas/Pagina.md'));
  const imported = importVault(library, source, 'Importado');
  assert.equal(imported.copied, 1);
  assert.equal(fs.readFileSync(path.join(source, 'Notas/Pagina.md')).equals(stamp), true);
  assert.equal(fs.existsSync(path.join(root, 'Importado/Notas/Pagina.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'Importado/.obsidian')), false);

  saveView(library, 'Leituras.view', { nome: 'Leituras', modo: 'tabela', estante: 'Estudos' });
  assert.equal(listViews(library)[0].modo, 'tabela');
  const viaTool = callTool('view.list', { libraryPath: root }) as Array<{ nome: string }>;
  assert.equal(viaTool[0].nome, 'Leituras');
});
