import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { listActivity } from './activity.ts';
import { createMcpServer } from './mcp.ts';
import { issueKey, mcpBin, mcpEnv } from './mcp-harness.ts';
import { toggleClient } from './mcp-clients.ts';
import { openSession } from './mcp-sessions.ts';
import { openLibrary } from './library.ts';
import { listTrash, trashEntry } from './lixeira.ts';
import { createNote } from './library.ts';
import { toolsForPermission } from './permissions.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-mcp-auth-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  return root;
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }) {
  return (result.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');
}

async function connectMemory(root: string, issued: ReturnType<typeof issueKey>, permission: 'leitura' | 'escrita') {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const gate = { close: () => void serverTransport.close() };
  const server = createMcpServer(root, {
    permission,
    userData: issued.userData,
    key: issued.chave,
    closeSession: () => gate.close(),
  });
  openSession(issued.id, () => gate.close());
  await server.connect(serverTransport);
  const client = new Client({ name: 'memoria', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

test('leitura anuncia só leitura e escrita não anuncia o que é destrutivo', async () => {
  const root = library();
  const leitura = issueKey('leitura', 'Claude');
  const client = await connectMemory(root, leitura, 'leitura');
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, toolsForPermission('leitura').map((tool) => tool.name).sort());
    assert.equal(names.includes('note.create'), false);
    assert.equal(names.includes('activity.list'), true);
    assert.equal(names.includes('activity.undo'), false);
    const denied = await client.callTool({
      name: 'note.create',
      arguments: { path: 'Nota.md', body: 'nao\n' },
    });
    assert.equal(denied.isError, true);
    assert.match(textOf(denied), /permissao_negada/);
    assert.equal(fs.existsSync(path.join(root, 'Nota.md')), false);
    const read = await client.callTool({ name: 'workspace.list', arguments: {} });
    assert.notEqual(read.isError, true, textOf(read));
  } finally {
    await client.close();
  }
});

test('escrita grava com o nome do cliente e recusa purge, export e library.switch', async () => {
  const root = library();
  createNote(openLibrary(root), 'Velha.md', 'velha\n');
  const trashed = trashEntry(openLibrary(root), 'Velha.md');
  const escrita = issueKey('escrita', 'Codex');
  const client = await connectMemory(root, escrita, 'escrita');
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const hidden of ['trash.purge', 'trash.empty', 'note.deletePermanent', 'vault.import', 'site.export'])
      assert.equal(names.includes(hidden), false, hidden);
    const created = await client.callTool({
      name: 'note.create',
      arguments: { path: 'Nova.md', body: 'nova\n' },
    });
    assert.notEqual(created.isError, true, textOf(created));
    const purge = await client.callTool({ name: 'trash.purge', arguments: { id: trashed.id } });
    assert.equal(purge.isError, true);
    assert.match(textOf(purge), /permissao_negada/);
    assert.equal(listTrash(openLibrary(root)).some((item) => item.id === trashed.id), true);
    const switched = await client.callTool({ name: 'library.switch', arguments: { path: root } });
    assert.equal(switched.isError, true);
    assert.match(textOf(switched), /permissao_negada/);
    const rows = listActivity(openLibrary(root));
    assert.equal(rows.some((row) => row.autor === 'mcp:Codex' && row.tool === 'note.create'), true);
  } finally {
    await client.close();
  }
});

test('revogar ou desativar derruba a sessão e a chamada seguinte não entra', async () => {
  const root = library();
  const issued = issueKey('escrita', 'Claude');
  const client = await connectMemory(root, issued, 'escrita');
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length > 0, true);
    const touched = JSON.parse(fs.readFileSync(path.join(issued.userData, 'mcp-clients.json'), 'utf8')) as {
      clients: Array<{ ultimoUso: string | null }>;
    };
    assert.equal(typeof touched.clients[0]?.ultimoUso, 'string');
    toggleClient(issued.userData, { id: issued.id, ativo: false });
    let refused = false;
    try {
      const again = await client.callTool({ name: 'workspace.list', arguments: {} });
      refused = again.isError === true && /cliente_desativado/.test(textOf(again));
    } catch {
      refused = true;
    }
    assert.equal(refused, true);
  } finally {
    await client.close().catch(() => {});
  }
});

test('stdio sem chave ou com cliente desativado não sobe', () => {
  const root = library();
  const issued = issueKey('leitura', 'Codex');
  const env = mcpEnv(issued.userData, issued.chave);
  delete env.SOPHY_MCP_KEY;
  const missing = spawnSync(
    process.execPath,
    ['--experimental-strip-types', mcpBin, 'mcp', '--biblioteca', root],
    { encoding: 'utf8', env, cwd: os.tmpdir(), timeout: 8000 },
  );
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /chave_invalida/);
  toggleClient(issued.userData, { id: issued.id, ativo: false });
  const disabled = spawnSync(
    process.execPath,
    ['--experimental-strip-types', mcpBin, 'mcp', '--biblioteca', root],
    { encoding: 'utf8', env: mcpEnv(issued.userData, issued.chave), cwd: os.tmpdir(), timeout: 8000 },
  );
  assert.equal(disabled.status, 2);
  assert.match(disabled.stderr, /cliente_desativado/);
});

test('HTTP recusa Bearer ausente ou inválido e aceita a chave do cliente', async () => {
  const root = library();
  const issued = issueKey('escrita', 'Claude');
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', mcpBin, 'mcp', '--biblioteca', root, '--http=0'],
    { env: mcpEnv(issued.userData, 'nao-usada'), cwd: os.tmpdir(), stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(stderr || 'o HTTP não anunciou a porta')), 10000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = stderr.match(/MCP HTTP em (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`o HTTP saiu com ${code}: ${stderr}`));
    });
  });
  try {
    const missing = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    assert.equal(missing.status, 401);
    const missingBody = (await missing.json()) as { error?: { message?: string } };
    assert.equal(missingBody.error?.message, 'chave_invalida');
    const wrong = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sph_nao' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize' }),
    });
    assert.equal(wrong.status, 401);
    assert.equal(((await wrong.json()) as { error?: { message?: string } }).error?.message, 'chave_invalida');
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${issued.chave}` } },
    });
    const client = new Client({ name: 'http', version: '0.0.0' });
    await client.connect(transport);
    try {
      const created = await client.callTool({
        name: 'note.create',
        arguments: { path: 'Http.md', body: 'pelo http\n' },
      });
      assert.notEqual(created.isError, true, textOf(created));
      assert.match(fs.readFileSync(path.join(root, 'Http.md'), 'utf8'), /pelo http/);
      assert.equal(
        listActivity(openLibrary(root)).some((row) => row.autor === 'mcp:Claude'),
        true,
      );
    } finally {
      await client.close();
    }
  } finally {
    child.kill('SIGTERM');
  }
});
