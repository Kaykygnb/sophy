import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { callTool, tools } from './tools.ts';
import { subscribeUi, type UiCommand } from './ui-bridge.ts';

const bin = path.resolve('engine/bin/sophy');
const sensitive = /api[-_ ]?key|\b(secret|password|token|senha|credential)s?\b/i;

function environment() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== 'SOPHY_LIBRARY') env[key] = value;
  }
  return env;
}

async function connect(root: string) {
  const transport = new StdioClientTransport({
    command: bin,
    args: ['mcp', '--biblioteca', root],
    cwd: os.tmpdir(),
    env: environment(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'sophy-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-mcp-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  return root;
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }) {
  return (result.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');
}

function jsonOf<T>(result: { content?: Array<{ type: string; text?: string }> }) {
  return JSON.parse(textOf(result)) as T;
}

test('listTools bate com o registro e cada inputSchema é válido', { timeout: 30000 }, async () => {
  const client = await connect(library());
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, tools.map((tool) => tool.name).sort());
    const validator = new AjvJsonSchemaValidator();
    for (const tool of listed.tools) {
      assert.equal(typeof tool.inputSchema, 'object');
      const check = validator.getValidator(tool.inputSchema);
      assert.equal(typeof check({}).valid, 'boolean');
      assert.equal(sensitive.test(tool.name), false);
      assert.equal(sensitive.test(tool.description ?? ''), false);
      assert.equal(sensitive.test(JSON.stringify(tool.inputSchema)), false);
    }
  } finally {
    await client.close();
  }
});

test('note.read devolve o corpo gravado', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({ name: 'note.create', arguments: { path: 'Nota.md', body: 'oi [[' } });
    const read = await client.callTool({ name: 'note.read', arguments: { path: 'Nota.md' } });
    assert.notEqual(read.isError, true, textOf(read));
    assert.equal(jsonOf<{ body: string }>(read).body, 'oi [[');
  } finally {
    await client.close();
  }
});

test('search.query devolve segmentos sem Markdown cru', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Estudos/Nota.md', body: 'Um gato [[Outra|o outro]]' },
    });
    const found = await client.callTool({ name: 'search.query', arguments: { query: 'gato' } });
    assert.notEqual(found.isError, true, textOf(found));
    const hits = jsonOf<Array<{ path: string; segments: Array<{ text: string }> }>>(found);
    assert.equal(hits[0]?.path, 'Estudos/Nota.md');
    assert.equal(
      hits[0]?.segments
        .map((part) => part.text)
        .join('')
        .includes('[['),
      false,
    );
  } finally {
    await client.close();
  }
});

test('graph.query devolve a aresta entre as notas', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Estudos/Nota.md', body: 'Veja [[Outra]]' },
    });
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Estudos/Outra.md', body: 'destino' },
    });
    const graph = await client.callTool({ name: 'graph.query', arguments: {} });
    assert.notEqual(graph.isError, true, textOf(graph));
    assert.deepEqual(jsonOf<{ edges: unknown[] }>(graph).edges, [
      { from: 'Estudos/Nota.md', to: 'Estudos/Outra.md', format: 'wiki' },
    ]);
  } finally {
    await client.close();
  }
});

test('links.outgoing e links.backlinks apontam a nota resolvida', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Estudos/Nota.md', body: 'Veja [[Outra]]' },
    });
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Estudos/Outra.md', body: 'destino' },
    });
    const outgoing = await client.callTool({
      name: 'links.outgoing',
      arguments: { path: 'Estudos/Nota.md' },
    });
    assert.notEqual(outgoing.isError, true, textOf(outgoing));
    assert.equal(jsonOf<Array<{ path: string }>>(outgoing)[0]?.path, 'Estudos/Outra.md');
    const incoming = await client.callTool({
      name: 'links.backlinks',
      arguments: { path: 'Estudos/Outra.md' },
    });
    assert.notEqual(incoming.isError, true, textOf(incoming));
    assert.equal(jsonOf<Array<{ from: string }>>(incoming)[0]?.from, 'Estudos/Nota.md');
  } finally {
    await client.close();
  }
});

test('note.create grava o corpo e note.write atualiza', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    const created = await client.callTool({
      name: 'note.create',
      arguments: { path: 'Nota.md', body: 'um' },
    });
    assert.notEqual(created.isError, true, textOf(created));
    const revision = jsonOf<{ revision: string }>(created).revision;
    const written = await client.callTool({
      name: 'note.write',
      arguments: { path: 'Nota.md', body: 'dois', expectedRevision: revision },
    });
    assert.notEqual(written.isError, true, textOf(written));
    assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'dois');
  } finally {
    await client.close();
  }
});

test('entry.move reescreve o wikilink que apontava para a nota', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Estudos/Nota.md', body: 'destino' },
    });
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Estudos/Outra.md', body: 'A [[Nota|apelido]]' },
    });
    const moved = await client.callTool({
      name: 'entry.move',
      arguments: { from: 'Estudos/Nota.md', to: 'Livro/Movida.md' },
    });
    assert.notEqual(moved.isError, true, textOf(moved));
    assert.equal(
      fs.readFileSync(path.join(root, 'Estudos', 'Outra.md'), 'utf8'),
      'A [[Livro/Movida|apelido]]',
    );
  } finally {
    await client.close();
  }
});

test('entry.trash tira a nota da biblioteca', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({ name: 'note.create', arguments: { path: 'Nota.md', body: 'sai' } });
    const removed = await client.callTool({ name: 'entry.trash', arguments: { path: 'Nota.md' } });
    assert.notEqual(removed.isError, true, textOf(removed));
    assert.equal(fs.existsSync(path.join(root, 'Nota.md')), false);
  } finally {
    await client.close();
  }
});

test('history.undo desfaz a criação', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({ name: 'note.create', arguments: { path: 'Nota.md', body: 'um' } });
    const undone = await client.callTool({ name: 'history.undo', arguments: {} });
    assert.notEqual(undone.isError, true, textOf(undone));
    assert.equal(fs.existsSync(path.join(root, 'Nota.md')), false);
  } finally {
    await client.close();
  }
});

test('a origem gravada é mcp mesmo quando o input pede outra', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Nota.md', body: 'z', origin: 'agent' },
    });
    const history = jsonOf<Array<{ origin: string; tool: string }>>(
      await client.callTool({ name: 'history.list', arguments: {} }),
    );
    assert.equal(history[0]?.tool, 'note.create');
    assert.equal(history[0]?.origin, 'mcp');
  } finally {
    await client.close();
  }
});

test('o caminho de biblioteca enviado pelo cliente é ignorado', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    const created = await client.callTool({
      name: 'note.create',
      arguments: { path: 'Nota.md', body: 'aqui', libraryPath: os.homedir() },
    });
    assert.notEqual(created.isError, true, textOf(created));
    assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'aqui');
    assert.equal(fs.existsSync(path.join(os.homedir(), 'Nota.md')), false);
  } finally {
    await client.close();
  }
});

test('conflito de revisão vira isError com mensagem', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Nota.md', body: 'original' },
    });
    const conflict = await client.callTool({
      name: 'note.write',
      arguments: { path: 'Nota.md', body: 'outro', expectedRevision: '0'.repeat(64) },
    });
    assert.equal(conflict.isError, true);
    assert.match(textOf(conflict), /Nada foi gravado/);
    assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'original');
  } finally {
    await client.close();
  }
});

test('link ambíguo vira isError com mensagem', { timeout: 30000 }, async () => {
  const root = library();
  const client = await connect(root);
  try {
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Estudos/Nota.md', body: 'a' },
    });
    await client.callTool({ name: 'note.create', arguments: { path: 'Livro/Nota.md', body: 'b' } });
    await client.callTool({
      name: 'note.create',
      arguments: { path: 'Meio/Ponte.md', body: 'Veja [[Nota]]' },
    });
    const ambiguous = await client.callTool({
      name: 'links.outgoing',
      arguments: { path: 'Meio/Ponte.md' },
    });
    assert.equal(ambiguous.isError, true);
    assert.match(textOf(ambiguous), /Há link ambíguo/);
  } finally {
    await client.close();
  }
});

test('caminho proibido vira isError com mensagem', { timeout: 30000 }, async () => {
  const client = await connect(library());
  try {
    const forbidden = await client.callTool({
      name: 'note.read',
      arguments: { path: '../segredo.md' },
    });
    assert.equal(forbidden.isError, true);
    assert.match(textOf(forbidden), /inválido|reservado|fora da biblioteca/);
  } finally {
    await client.close();
  }
});

test(
  'resource sophy://nota lê a nota e recusa caminho inexistente',
  { timeout: 30000 },
  async () => {
    const root = library();
    const client = await connect(root);
    try {
      await client.callTool({
        name: 'note.create',
        arguments: { path: 'Estudos/Nota.md', body: 'oi [[' },
      });
      const listed = await client.listResources();
      assert.ok(listed.resources.some((item) => item.uri === 'sophy://nota/Estudos/Nota.md'));
      assert.equal(
        listed.resources.some((item) => sensitive.test(`${item.uri} ${item.name ?? ''}`)),
        false,
      );
      const found = await client.readResource({ uri: 'sophy://nota/Estudos/Nota.md' });
      assert.equal(found.contents[0]?.text, 'oi [[');
      await assert.rejects(
        () => client.readResource({ uri: 'sophy://nota/Estudos/NaoExiste.md' }),
        /não encontrad/i,
      );
    } finally {
      await client.close();
    }
  },
);

test('cada tool ui.* sem interface diz que ela não está aberta', { timeout: 30000 }, async () => {
  const client = await connect(library());
  try {
    const calls = [
      ['ui.openNote', { path: 'Nota.md' }],
      ['ui.openCanvas', { path: 'Mapa.canvas' }],
      ['ui.showGraph', {}],
      ['ui.setTheme', { theme: 'dark' }],
    ] as const;
    for (const [name, arguments_] of calls) {
      const result = await client.callTool({ name, arguments: arguments_ });
      assert.equal(result.isError, true, name);
      assert.match(textOf(result), /A interface não está aberta/);
    }
  } finally {
    await client.close();
  }
});

test('subscribeUi entrega cada comando de interface', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  const seen: UiCommand[] = [];
  const stop = subscribeUi((command) => seen.push(command));
  try {
    callTool('ui.openNote', { libraryPath: root, path: 'Nota.md' });
    callTool('ui.openCanvas', { libraryPath: root, path: 'Mapa.canvas' });
    callTool('ui.showGraph', { libraryPath: root, workspace: 'Estudos' });
    callTool('ui.setTheme', { theme: 'light' });
    assert.deepEqual(
      seen.map((command) => command.type),
      ['openNote', 'openCanvas', 'showGraph', 'setTheme'],
    );
    assert.equal(seen[2] && 'workspace' in seen[2] ? seen[2].workspace : '', 'Estudos');
  } finally {
    stop();
  }
  for (const [name, arguments_] of [
    ['ui.openNote', { libraryPath: root, path: 'Nota.md' }],
    ['ui.openCanvas', { libraryPath: root, path: 'Mapa.canvas' }],
    ['ui.showGraph', { libraryPath: root }],
    ['ui.setTheme', { theme: 'dark' }],
  ] as const) {
    assert.throws(() => callTool(name, arguments_), /A interface não está aberta/);
  }
});
