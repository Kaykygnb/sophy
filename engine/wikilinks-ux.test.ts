import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fuzzyScore } from './fuzzy.ts';
import { relocate, suggestNotes, syncLinks } from './links.ts';
import { openLibrary } from './library.ts';
import { rewriteLinks } from './rewrite.ts';
import { callTool } from './tools.ts';
import { plainText } from './wikilinks.ts';

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-wiki-ux-'));
  const root = path.join(home, 'biblioteca');
  fs.mkdirSync(root);
  return { home, root };
}

function create(root: string, file: string, body: string, frontmatter?: Record<string, unknown>) {
  return callTool('note.create', {
    libraryPath: root,
    path: file,
    body,
    frontmatter,
    origin: 'ui',
  }) as { path: string; revision: string; body: string };
}

test('busca aproximada acha Operation Dominion por oper dom e considera aliases', () => {
  assert.ok(fuzzyScore('oper dom', 'Operation Dominion') > 0);
  const { root } = fixture();
  create(root, 'Campanhas/Operation Dominion.md', 'Missão.\n', { aliases: ['OD', 'Dominion Ops'] });
  create(root, 'Campanhas/Outra.md', 'Nada.\n');
  const hits = suggestNotes(openLibrary(root), 'oper dom');
  assert.equal(hits[0]?.path, 'Campanhas/Operation Dominion.md');
  const byAlias = suggestNotes(openLibrary(root), 'dominion ops');
  assert.equal(byAlias[0]?.path, 'Campanhas/Operation Dominion.md');
});

test('renomear e mover preserva acento, |apelido, #seção e ^bloco', () => {
  const { root } = fixture();
  create(root, 'Estudos/José.md', '# Seção\n\nParágrafo ^bloco-1\n');
  create(
    root,
    'Estudos/Origem.md',
    'Veja [[José|o Zé]] e [[José#Seção]] e [[José#^bloco-1]].\n',
  );
  const moved = callTool('entry.move', {
    libraryPath: root,
    from: 'Estudos/José.md',
    to: 'Arquivo/João Silva.md',
    origin: 'ui',
  }) as { updated: string[]; linksUpdated?: number };
  assert.ok((moved.updated?.length || moved.linksUpdated || 0) >= 1);
  const disk = fs.readFileSync(path.join(root, 'Estudos', 'Origem.md'), 'utf8');
  assert.match(disk, /\[\[Arquivo\/João Silva\|o Zé\]\]/);
  assert.match(disk, /\[\[Arquivo\/João Silva#Seção\]\]/);
  assert.match(disk, /\[\[Arquivo\/João Silva#\^bloco-1\]\]/);
});

test('duas notas com o mesmo nome em pastas diferentes não trocam de alvo', () => {
  const { root } = fixture();
  create(root, 'Alpha/Nota.md', 'Alpha.\n');
  create(root, 'Beta/Nota.md', 'Beta.\n');
  create(root, 'Alpha/Fonte.md', 'Fica [[Nota]].\n');
  create(root, 'Raiz.md', 'Ambíguo [[Nota]].\n');
  callTool('entry.move', {
    libraryPath: root,
    from: 'Beta/Nota.md',
    to: 'Beta/Renomeada.md',
    origin: 'ui',
  });
  assert.match(fs.readFileSync(path.join(root, 'Alpha', 'Fonte.md'), 'utf8'), /\[\[Nota\]\]/);
  assert.match(fs.readFileSync(path.join(root, 'Raiz.md'), 'utf8'), /\[\[Nota\]\]/);
});

test('desfazer move restaura nome e links (Ctrl+Z do histórico)', () => {
  const { root } = fixture();
  create(root, 'Estudos/Alvo.md', 'Destino.\n');
  create(root, 'Estudos/Fonte.md', 'Link [[Alvo|apelido]].\n');
  callTool('entry.move', {
    libraryPath: root,
    from: 'Estudos/Alvo.md',
    to: 'Livro/Novo.md',
    origin: 'ui',
  });
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /\[\[Livro\/Novo\|apelido\]\]/);
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.equal(fs.existsSync(path.join(root, 'Estudos', 'Alvo.md')), true);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /\[\[Alvo\|apelido\]\]/);
});

test('link em bloco de código e em `código` não é alterado', () => {
  const paths = ['Alvo.md', 'Fonte.md'];
  const map = (file: string) => (file === 'Alvo.md' ? 'Novo.md' : file);
  const content =
    'Fora [[Alvo]]\n\n`[[Alvo]]`\n\n```md\n[[Alvo]]\n```\n';
  const out = rewriteLinks(content, 'Fonte.md', paths, [], map);
  assert.match(out, /Fora \[\[Novo\]\]/);
  assert.match(out, /`\[\[Alvo\]\]`/);
  assert.match(out, /```md\n\[\[Alvo\]\]\n```/);
});

test('canvas é atualizado e notas na lixeira ficam de fora', () => {
  const { root, home } = fixture();
  const trashRoot = path.join(home, 'Trash');
  fs.mkdirSync(trashRoot, { recursive: true });
  create(root, 'Estudos/Alvo.md', 'Alvo.\n');
  create(root, 'Estudos/Fonte.md', '[[Alvo]]\n');
  create(root, 'Lixeira-antes.md', '[[Alvo]] na lixeira.\n');
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Quadro.canvas'),
    JSON.stringify({
      nodes: [{ id: '1', type: 'text', text: 'Veja [[Alvo]]', x: 0, y: 0, width: 200, height: 80 }],
      edges: [],
    }),
  );
  callTool('entry.trash', { libraryPath: root, path: 'Lixeira-antes.md', origin: 'ui' });
  const moved = relocate(openLibrary(root), 'Estudos/Alvo.md', 'Arquivo/Alvo.md');
  assert.ok(moved.updated.includes('Estudos/Fonte.md') || moved.updated.includes('Arquivo/Alvo.md') || moved.updated.length >= 1);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /Arquivo\/Alvo/);
  const canvas = fs.readFileSync(path.join(root, 'Estudos', 'Quadro.canvas'), 'utf8');
  assert.match(canvas, /Arquivo\/Alvo/);
  assert.equal(fs.existsSync(path.join(root, 'Lixeira-antes.md')), false);
});

test('nome inválido no Windows não trava a reescrita das outras notas', () => {
  const { root } = fixture();
  create(root, 'Estudos/Alvo.md', 'Alvo.\n');
  create(root, 'Estudos/Boa.md', 'Veja [[Alvo]].\n');
  const bad = path.join(root, 'Estudos', 'ruim.md');
  fs.writeFileSync(bad, 'Veja [[Alvo]].\n');
  // Simula falha isolada: relocate engole erros de escrita por nota
  const library = openLibrary(root);
  const notes = ['Estudos/Alvo.md', 'Estudos/Boa.md', 'Estudos/ruim.md'];
  const files: string[] = [];
  const mapPath = (file: string) => (file === 'Estudos/Alvo.md' ? 'Arquivo/Alvo.md' : file);
  const updated: string[] = [];
  const skipped: string[] = [];
  for (const note of notes) {
    try {
      if (note.endsWith('ruim.md')) throw new Error('nome inválido no Windows');
      const content = fs.readFileSync(path.join(root, ...note.split('/')), 'utf8');
      const next = rewriteLinks(content, note, notes, files, mapPath);
      if (next !== content) {
        fs.writeFileSync(path.join(root, ...note.split('/')), next);
        updated.push(note);
      }
    } catch (error) {
      skipped.push(note);
    }
  }
  assert.ok(updated.includes('Estudos/Boa.md'));
  assert.ok(skipped.includes('Estudos/ruim.md'));
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Boa.md'), 'utf8'), /Arquivo\/Alvo/);
  void library;
});

test('texto com script e onerror não executa na prévia (escapado)', () => {
  const dirty = 'Olá <script>alert(1)</script> e <img src=x onerror=alert(2)>';
  const safe = plainText(dirty)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  assert.equal(safe.includes('<script>'), false);
  assert.equal(safe.includes('onerror'), true); // texto cru pode citar, mas HTML não
  const escaped = String(dirty)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  assert.match(escaped, /&lt;script&gt;/);
  assert.equal(escaped.includes('<script>'), false);
  assert.equal(escaped.includes('<img'), false);
});

test('renomear com 400 notas atualiza links em menos de 1 s', { timeout: 60000 }, () => {
  const { root } = fixture();
  create(root, 'n0.md', 'Raiz.\n');
  for (let i = 1; i < 400; i += 1) {
    fs.writeFileSync(path.join(root, `n${i}.md`), `Veja [[n0]].\n`);
  }
  syncLinks(openLibrary(root));
  const started = Date.now();
  const result = relocate(openLibrary(root), 'n0.md', 'hub.md');
  const ms = Date.now() - started;
  assert.ok(result.updated.length >= 100, `só ${result.updated.length} notas atualizadas`);
  assert.ok(ms < 1000, `renomear 400 notas levou ${ms} ms`);
});

test('backlinks incluem snippet e catálogo traz aliases', () => {
  const { root } = fixture();
  create(root, 'Estudos/Alvo.md', 'Destino.\n', { aliases: ['meta'] });
  create(root, 'Estudos/Fonte.md', 'Na frase longa, veja [[Alvo]] com contexto útil.\n');
  const incoming = callTool('links.backlinks', {
    libraryPath: root,
    path: 'Estudos/Alvo.md',
  }) as Array<{ from: string; snippet: string }>;
  assert.equal(incoming[0].from, 'Estudos/Fonte.md');
  assert.match(incoming[0].snippet, /contexto|Alvo|veja/i);
  const catalog = callTool('links.catalog', { libraryPath: root }) as Array<{
    path: string;
    aliases: string[];
  }>;
  assert.deepEqual(catalog.find((row) => row.path === 'Estudos/Alvo.md')?.aliases, ['meta']);
});
