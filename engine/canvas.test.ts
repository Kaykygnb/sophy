import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseCanvas, serializeCanvas } from './canvas.ts';
import { backlinks } from './links.ts';
import { queryGraph } from './graph.ts';
import { callTool } from './tools.ts';

const bin = path.resolve('engine/cli.ts');
const sample = {
  nodes: [
    {
      id: 'texto',
      type: 'text',
      x: 10,
      y: 20,
      width: 240,
      height: 120,
      text: 'Veja [[Estudos/Leitura|a leitura]] e um [[ incompleto.',
      extra: true,
    },
    {
      id: 'arquivo',
      type: 'file',
      x: 300,
      y: 20,
      width: 220,
      height: 140,
      file: 'Estudos/Leitura.md',
    },
    {
      id: 'grupo',
      type: 'group',
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      label: 'Estudos',
      color: '1',
    },
    { id: 'url', type: 'link', x: 40, y: 280, width: 200, height: 60, url: 'https://obsidian.md' },
  ],
  edges: [
    {
      id: 'liga',
      fromNode: 'texto',
      toNode: 'arquivo',
      fromSide: 'right',
      toSide: 'left',
      toEnd: 'arrow',
      label: 'explica',
      color: '2',
    },
  ],
};

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-canvas-'));
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '# Leitura\n\ntexto\n');
  return root;
}

test('JSON Canvas volta com nós, arestas, texto e campo extra', () => {
  const again = parseCanvas(serializeCanvas(parseCanvas(JSON.stringify(sample))));
  assert.equal(again.nodes[0].text, 'Veja [[Estudos/Leitura|a leitura]] e um [[ incompleto.');
  assert.equal(again.nodes[0].extra, true);
  assert.equal(again.nodes[1].file, 'Estudos/Leitura.md');
  assert.equal(again.edges?.[0].fromSide, 'right');
  assert.equal(again.edges?.[0].toEnd, 'arrow');
  assert.equal(again.edges?.[0].label, 'explica');
  assert.equal(again.nodes.find((node) => node.type === 'group')?.label, 'Estudos');
});

test('wikilink de cartão entra no backlink e no grafo', () => {
  const root = library();
  callTool('canvas.create', {
    libraryPath: root,
    path: 'Mapa.canvas',
    document: sample,
    origin: 'ui',
  });
  const incoming = backlinks({ root, identity: { dev: '0', ino: '0' } }, 'Estudos/Leitura.md');
  assert.equal(
    incoming.some((link) => link.from === 'Mapa.canvas'),
    true,
  );
  const graph = queryGraph({ root, identity: { dev: '0', ino: '0' } });
  assert.equal(
    graph.edges.some((edge) => edge.from === 'Mapa.canvas' && edge.to === 'Estudos/Leitura.md'),
    true,
  );
  assert.equal(
    graph.nodes.some((node) => node.path === 'Mapa.canvas'),
    true,
  );
});

test('mover a nota reescreve o cartão de texto e o nó file, e o undo devolve', () => {
  const root = library();
  const created = callTool('canvas.create', {
    libraryPath: root,
    path: 'Mapa.canvas',
    document: sample,
    origin: 'ui',
  }) as { revision: string };
  callTool('entry.move', {
    libraryPath: root,
    from: 'Estudos/Leitura.md',
    to: 'Livro/Leitura.md',
    origin: 'ui',
  });
  const text = fs.readFileSync(path.join(root, 'Mapa.canvas'), 'utf8');
  assert.match(text, /\[\[Livro\/Leitura\|a leitura\]\]/);
  assert.match(text, /"file": "Livro\/Leitura.md"/);
  assert.match(text, /\[\[ incompleto/);
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  const restored = fs.readFileSync(path.join(root, 'Mapa.canvas'), 'utf8');
  assert.match(restored, /\[\[Estudos\/Leitura\|a leitura\]\]/);
  assert.match(restored, /"file": "Estudos\/Leitura.md"/);
  assert.equal(typeof created.revision, 'string');
});

test('a CLI grava e lê o canvas com origem cli', () => {
  const root = library();
  const env = { ...process.env };
  delete env.SOPHY_LIBRARY;
  const created = spawnSync(
    process.execPath,
    ['--experimental-strip-types', bin, 'canvas.create', '--biblioteca', root, '--path', 'Mapa.canvas', '--json'],
    { encoding: 'utf8', cwd: os.tmpdir(), env },
  );
  assert.equal(created.status, 0, created.stderr);
  const read = spawnSync(
    process.execPath,
    ['--experimental-strip-types', bin, 'canvas.read', '--biblioteca', root, '--path', 'Mapa.canvas', '--json'],
    { encoding: 'utf8', cwd: os.tmpdir(), env },
  );
  assert.equal(read.status, 0, read.stderr);
  const parsed = JSON.parse(read.stdout);
  assert.deepEqual(parsed.document.nodes, []);
  const history = callTool('history.list', { libraryPath: root }) as Array<{ origin: string }>;
  assert.equal(history[0].origin, 'cli');
});

test('o MCP cria o canvas pela tool do registro', { timeout: 30000 }, async () => {
  const root = library();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== 'SOPHY_LIBRARY') env[key] = value;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', bin, 'mcp', '--biblioteca', root, '--escrita'],
    cwd: os.tmpdir(),
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'sophy-canvas', version: '0.0.0' });
  await client.connect(transport);
  try {
    const created = await client.callTool({
      name: 'canvas.create',
      arguments: { path: 'Mapa.canvas', origin: 'ui' },
    });
    assert.notEqual(created.isError, true);
    const text = fs.readFileSync(path.join(root, 'Mapa.canvas'), 'utf8');
    assert.match(text, /"nodes": \[\]/);
    const history = callTool('history.list', { libraryPath: root }) as Array<{ origin: string }>;
    assert.equal(history[0].origin, 'mcp');
  } finally {
    await client.close();
  }
});
