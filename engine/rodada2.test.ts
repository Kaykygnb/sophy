import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentConfirmation, runAgentTurn } from './agent.ts';
import { importVault } from './extras.ts';
import { queryGraph } from './graph.ts';
import { capture, diff, pushHistory, undoLast } from './history.ts';
import { moveEntry, createNote, listNotes, openLibrary } from './library.ts';
import { callTool } from './tools.ts';
import { listTasks } from './tasks.ts';
import { backlinks, outgoingLinks } from './links.ts';
import { exportSite, listVersions, saveVersionPoint } from './study.ts';
import { uiDirectory } from './ui-bridge.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-r2-'));
  return openLibrary(root);
}

test('backlinks e grafo de 400 notas ficam abaixo do limite', { timeout: 60000 }, () => {
  const opened = library();
  for (let index = 0; index < 400; index += 1) {
    const next = (index + 1) % 400;
    const after = (index + 2) % 400;
    createNote(opened, `n${index}.md`, `# N${index}\n\n[[n${next}]] e [[n${after}]].\n`);
  }
  const started = performance.now();
  const incoming = backlinks(opened, 'n0.md');
  const backMs = performance.now() - started;
  const graphStarted = performance.now();
  const graph = queryGraph(opened);
  const graphMs = performance.now() - graphStarted;
  assert.ok(incoming.length >= 2, 'os backlinks de n0 sumiram');
  assert.ok(graph.edges.length > 100, 'o grafo não ligou as notas');
  assert.ok(backMs < 1000, `backlinks levou ${backMs.toFixed(0)} ms`);
  assert.ok(graphMs < 1500, `grafo levou ${graphMs.toFixed(0)} ms`);
});

test('a prévia da versão é o texto da nota aberta', () => {
  const opened = library();
  fs.mkdirSync(path.join(opened.root, 'Estudos'));
  createNote(opened, 'Estudos/Capa.md', '# Capa\n\nPrimeiro arquivo.\n');
  createNote(opened, 'Estudos/Versao.md', '# Versao\n\nTexto antigo da nota.\n');
  saveVersionPoint(opened, 'antes');
  const rows = listVersions(opened, 'Estudos/Versao.md');
  assert.match(rows[0].preview, /Texto antigo da nota/);
  assert.doesNotMatch(rows[0].preview, /Primeiro arquivo/);
});

test('o site formata subtítulo, lista e wikilink', () => {
  const opened = library();
  createNote(opened, 'Nota.md', '# Título\n\n## Sub\n\n- um\n- dois\n\nVeja [[Nota]].\n');
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-site-'));
  exportSite(opened, destination, 'light');
  const html = fs.readFileSync(path.join(destination, 'Nota.html'), 'utf8');
  assert.match(html, /<h3>Sub<\/h3>/);
  assert.match(html, /<li>um<\/li><li>dois<\/li>/);
  assert.match(html, /Veja Nota/);
  assert.doesNotMatch(html, /\[\[Nota\]\]/);
});

test('importar pula con.md e a terceira cópia ganha sufixo', () => {
  const opened = library();
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-vault-'));
  fs.writeFileSync(path.join(vault, 'a.md'), '# A\n');
  fs.writeFileSync(path.join(vault, 'con.md'), '# con\n');
  fs.writeFileSync(path.join(vault, 'zfim.md'), '# fim\n');
  const first = importVault(opened, vault, 'Importado');
  assert.equal(first.copied, 2);
  assert.equal(fs.existsSync(path.join(opened.root, 'Importado', 'zfim.md')), true);
  assert.match(first.skipped.join('\n'), /con\.md/);
  fs.writeFileSync(path.join(opened.root, 'Importado', 'a.md'), '# editada\n');
  importVault(opened, vault, 'Importado');
  const third = importVault(opened, vault, 'Importado');
  assert.equal(third.copied, 2);
  assert.equal(fs.readFileSync(path.join(opened.root, 'Importado', 'a.md'), 'utf8'), '# editada\n');
  assert.equal(fs.existsSync(path.join(opened.root, 'Importado', 'a (importado 2).md')), true);
});

test('um nome inválido não impede gravar, abrir nem renomear', () => {
  const opened = library();
  fs.mkdirSync(path.join(opened.root, 'Estudos'));
  createNote(opened, 'Estudos/A.md', '# A\n\nTexto.\n');
  fs.writeFileSync(path.join(opened.root, 'Estudos', 'nome?.md'), '# Pergunta\n\n');
  fs.mkdirSync(path.join(opened.root, `Ab'c"d`));
  fs.writeFileSync(path.join(opened.root, 'con.md'), '# con\n');
  const read = callTool('note.read', { libraryPath: opened.root, path: 'Estudos/A.md' }) as {
    revision: string;
  };
  const written = callTool('note.write', {
    libraryPath: opened.root,
    path: 'Estudos/A.md',
    body: '# A\n\nSalvo.\n',
    expectedRevision: read.revision,
    origin: 'ui',
  }) as { conflict: boolean };
  assert.equal(written.conflict, false);
  assert.match(fs.readFileSync(path.join(opened.root, 'Estudos', 'A.md'), 'utf8'), /Salvo/);
  assert.doesNotThrow(() => outgoingLinks(opened, 'Estudos/A.md'));
  assert.doesNotThrow(() => queryGraph(opened));
  assert.doesNotThrow(() => listTasks(opened));
  const bad = callTool('note.read', { libraryPath: opened.root, path: 'Estudos/nome?.md' }) as {
    body: string;
  };
  assert.match(bad.body, /Pergunta/);
  moveEntry(opened, 'Estudos/nome?.md', 'Estudos/nome.md');
  assert.equal(fs.existsSync(path.join(opened.root, 'Estudos', 'nome.md')), true);
});

test('nota com ? continua na lista, marcada', () => {
  const opened = library();
  fs.writeFileSync(path.join(opened.root, 'nome?.md'), '# Pergunta\n');
  const notes = listNotes(opened);
  const found = notes.find((note) => note.path.includes('?'));
  assert.ok(found);
  assert.equal(found?.unsafe, true);
});

test('a Sofi pede confirmação para sobrescrever, desfazer e mover estante', async () => {
  const opened = library();
  createNote(opened, 'Estudos.md', '# Estudos\n\nOriginal.\n');
  fs.mkdirSync(path.join(opened.root, 'Estudos'));
  const calls = [
    { name: 'note.write', arguments: { path: 'Estudos.md', body: '# Estudos\n\nApagado.\n', expectedRevision: '0'.repeat(64) } },
    { name: 'history.undo', arguments: {} },
    { name: 'entry.move', arguments: { from: 'Estudos', to: 'Arquivo' } },
  ];
  const denied = await runAgentTurn({
    libraryPath: opened.root,
    message: 'mexe',
    key: 'sk-teste-sofi-nao-gravar',
    confirm: async () => false,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok', tool_calls: calls.map((call) => ({ function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } }],
      }),
    }),
  });
  assert.equal(fs.readFileSync(path.join(opened.root, 'Estudos.md'), 'utf8').includes('Original'), true);
  assert.equal(fs.existsSync(path.join(opened.root, 'Estudos')), true);
  assert.equal(denied.results.filter((result) => result.skipped).length, 3);
  assert.match(agentConfirmation('entry.move', { from: 'Estudos/Nota.md', to: 'Outro.md' }), /Mover a nota/);
  assert.match(agentConfirmation('canvas.update', { path: 'Mapa.canvas' }), /Alterar o canvas/);
});

test('o MCP somente leitura recusa note.create', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-mcp-ro-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== 'SOPHY_LIBRARY' && key !== 'SOPHY_UI_DIR') env[key] = value;
  }
  env.SOPHY_UI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-mcp-'));
  const transport = new StdioClientTransport({
    command: path.resolve('engine/bin/sophy'),
    args: ['mcp', '--biblioteca', root],
    cwd: os.tmpdir(),
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'sophy-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'note.create', arguments: { path: 'Nota.md', body: '# N\n' } });
    assert.equal(result.isError, true);
    const theme = await client.callTool({ name: 'ui.setTheme', arguments: { theme: 'dark' } });
    assert.equal(theme.isError, true);
    const text = JSON.stringify(result) + JSON.stringify(theme);
    assert.match(text, /somente leitura/);
    assert.equal(fs.existsSync(path.join(root, 'Nota.md')), false);
  } finally {
    await client.close();
  }
});

test('apagar pelo sistema entra no histórico e o desfazer restaura', () => {
  const opened = library();
  createNote(opened, 'Nota.md', '# Nota\n\nAntes.\n');
  const before = capture(opened);
  fs.rmSync(path.join(opened.root, 'Nota.md'));
  pushHistory(opened, {
    origin: 'ui',
    tool: 'entry.trash',
    summary: 'Lixeira Nota.md',
    changes: diff(before, capture(opened)),
  });
  undoLast(opened);
  assert.match(fs.readFileSync(path.join(opened.root, 'Nota.md'), 'utf8'), /Antes/);
});

test('a pasta de presença dos testes não é a compartilhada', () => {
  const previous = process.env.SOPHY_UI_DIR;
  delete process.env.SOPHY_UI_DIR;
  try {
    assert.match(uiDirectory(), new RegExp(`sophy-ui-test-${process.pid}$`));
  } finally {
    if (previous) process.env.SOPHY_UI_DIR = previous;
  }
});
