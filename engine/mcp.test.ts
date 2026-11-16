import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { callTool } from './tools.ts';
import { subscribeUi } from './ui-bridge.ts';

const bin = path.resolve('engine/bin/sophy');

function environment(extra: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== 'SOPHY_LIBRARY') env[key] = value;
  }
  return { ...env, ...extra };
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

function textOf(result: { content?: Array<{ type: string; text?: string }> }) {
  return (result.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');
}

test('o canal de UI entrega o comando só quando a interface assina', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  const seen: string[] = [];
  const stop = subscribeUi((command) => seen.push(command.type));
  try {
    const delivered = callTool('ui.openNote', { libraryPath: root, path: 'Nota.md' }) as {
      delivered: boolean;
    };
    assert.equal(delivered.delivered, true);
    assert.deepEqual(seen, ['openNote']);
  } finally {
    stop();
  }
  assert.throws(() => callTool('ui.setTheme', { theme: 'dark' }), /interface não está aberta/);
});

test(
  'servidor MCP real lista tools, lê, grava com origem mcp e recusa UI, conflito e caminho',
  { timeout: 30000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-mcp-'));
    fs.mkdirSync(path.join(root, '.sophy'));
    const client = await connect(root);
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      assert.ok(names.includes('note.read'));
      assert.ok(names.includes('note.create'));
      assert.ok(names.includes('ui.openNote'));
      assert.equal(
        names.some((name) => /api.?key|secret|password|token|senha/i.test(name)),
        false,
      );
      const createdSchema = listed.tools.find((tool) => tool.name === 'note.create')
        ?.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      assert.ok(createdSchema?.properties?.path);
      assert.equal(createdSchema.properties?.origin, undefined);
      assert.equal((createdSchema.required ?? []).includes('origin'), false);
      assert.equal((createdSchema.required ?? []).includes('libraryPath'), false);

      const created = await client.callTool({
        name: 'note.create',
        arguments: {
          path: 'Estudos/Nota.md',
          body: 'oi [[',
          origin: 'ui',
          libraryPath: os.homedir(),
        },
      });
      assert.notEqual(created.isError, true, textOf(created));
      assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8'), 'oi [[');
      assert.equal(fs.existsSync(path.join(os.homedir(), 'Estudos', 'Nota.md')), false);

      const history = await client.callTool({ name: 'history.list', arguments: {} });
      const actions = JSON.parse(textOf(history)) as Array<{ origin: string; tool: string }>;
      assert.equal(actions[0].tool, 'note.create');
      assert.equal(actions[0].origin, 'mcp');

      const resource = await client.readResource({ uri: 'sophy://nota/Estudos/Nota.md' });
      assert.equal(resource.contents[0]?.text, 'oi [[');

      const forbidden = await client.callTool({
        name: 'note.read',
        arguments: { path: '../segredo.md' },
      });
      assert.equal(forbidden.isError, true);
      assert.match(textOf(forbidden), /inválido|reservado|fora da biblioteca/i);

      const conflict = await client.callTool({
        name: 'note.write',
        arguments: { path: 'Estudos/Nota.md', body: 'novo', expectedRevision: '0'.repeat(64) },
      });
      assert.equal(conflict.isError, true);
      assert.match(textOf(conflict), /Nada foi gravado/);
      assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8'), 'oi [[');

      await client.callTool({
        name: 'note.create',
        arguments: { path: 'Livro/Nota.md', body: 'b' },
      });
      await client.callTool({
        name: 'note.create',
        arguments: { path: 'Meio/Ponte.md', body: 'Veja [[Nota]]' },
      });
      const ambiguous = await client.callTool({
        name: 'links.outgoing',
        arguments: { path: 'Meio/Ponte.md' },
      });
      assert.equal(ambiguous.isError, true);
      assert.match(textOf(ambiguous), /ambíguo/);

      const offline = await client.callTool({
        name: 'ui.openNote',
        arguments: { path: 'Estudos/Nota.md' },
      });
      assert.equal(offline.isError, true);
      assert.match(textOf(offline), /interface não está aberta/);
      const theme = await client.callTool({
        name: 'ui.setTheme',
        arguments: { theme: 'dark' },
      });
      assert.equal(theme.isError, true);
      assert.match(textOf(theme), /interface não está aberta/);
    } finally {
      await client.close();
    }
  },
);
