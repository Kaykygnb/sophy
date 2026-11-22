import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sofiTools } from './agent.ts';
import { EngineError } from './errors.ts';
import {
  createClient,
  hashKey,
  legacyState,
  listClients,
  mcpAdmin,
  MCP_ADMIN_TOOLS,
  resolveAccess,
  revokeClient,
  setLegacy,
  toggleClient,
  userDataDir,
} from './mcp-clients.ts';
import { mcpConfigSnippet, serverKey } from './mcp-snippet.ts';
import { isReadOnlyTool, toolsForPermission } from './permissions.ts';
import { callTool, toolMutates, tools } from './tools.ts';

function dir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-chaves-'));
}

test('a chave sai uma vez, só o hash fica no userData e a lista não a devolve', () => {
  const userData = dir();
  const library = dir();
  const created = createClient(userData, { nome: 'Codex', permissao: 'escrita' });
  assert.match(created.chave, /^sph_[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(created.chave.slice(4), 'base64url').length, 32);
  const file = path.join(userData, 'mcp-clients.json');
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes(created.chave), false);
  assert.equal(raw.includes(hashKey(created.chave)), true);
  assert.equal(createHash('sha256').update(created.chave).digest('hex'), hashKey(created.chave));
  assert.equal(fs.existsSync(path.join(library, 'mcp-clients.json')), false);
  assert.equal(fs.existsSync(path.join(library, '.sophy', 'mcp-clients.json')), false);
  const listed = listClients(userData);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.final, `…${created.chave.slice(-4)}`);
  assert.equal(listed[0]?.nome, 'Codex');
  assert.equal(listed[0]?.permissao, 'escrita');
  assert.equal(listed[0]?.ativo, true);
  assert.equal(listed[0]?.ultimoUso, null);
  assert.equal(JSON.stringify(listed).includes(created.chave), false);
  assert.equal('chave' in (listed[0] ?? {}), false);
  assert.equal('hash' in (listed[0] ?? {}), false);
});

test('nome repetido, nome inválido, permissão inválida e cliente inexistente', () => {
  const userData = dir();
  createClient(userData, { nome: 'Claude', permissao: 'leitura' });
  assert.throws(
    () => createClient(userData, { nome: 'claude', permissao: 'leitura' }),
    (error: unknown) => error instanceof EngineError && error.code === 'nome_em_uso',
  );
  assert.throws(
    () => createClient(userData, { nome: ' ', permissao: 'leitura' }),
    (error: unknown) => error instanceof EngineError && error.code === 'nome_invalido',
  );
  assert.throws(
    () => createClient(userData, { nome: '../cofre', permissao: 'leitura' }),
    (error: unknown) => error instanceof EngineError && error.code === 'nome_invalido',
  );
  assert.throws(
    () => createClient(userData, { nome: 'Outro', permissao: 'admin' }),
    (error: unknown) => error instanceof EngineError && error.code === 'permissao_invalida',
  );
  assert.throws(
    () => revokeClient(userData, { id: 'nao-existe' }),
    (error: unknown) => error instanceof EngineError && error.code === 'cliente_inexistente',
  );
  assert.throws(
    () => toggleClient(userData, { id: 'nao-existe', ativo: false }),
    (error: unknown) => error instanceof EngineError && error.code === 'cliente_inexistente',
  );
  assert.throws(
    () => toggleClient(userData, { id: listClients(userData)[0]?.id, ativo: 'sim' }),
    (error: unknown) => error instanceof EngineError && error.code === 'ativo_invalido',
  );
});

test('revoke apaga e toggle desativa sem devolver a chave', () => {
  const userData = dir();
  const created = createClient(userData, { nome: 'Cursor', permissao: 'leitura' });
  const off = toggleClient(userData, { id: created.id, ativo: false });
  assert.equal(off.ativo, false);
  assert.equal(JSON.stringify(off).includes(created.chave), false);
  const denied = resolveAccess(userData, created.chave, {});
  assert.deepEqual(denied, { ok: false, erro: 'cliente_desativado' });
  toggleClient(userData, { id: created.id, ativo: true });
  const allowed = resolveAccess(userData, created.chave, {});
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(allowed.autor, 'mcp:Cursor');
  assert.deepEqual(revokeClient(userData, { id: created.id }), { id: created.id, removido: true });
  assert.deepEqual(listClients(userData), []);
  assert.deepEqual(resolveAccess(userData, created.chave, {}), { ok: false, erro: 'chave_invalida' });
});

test('chave errada não autentica e o legado nasce desligado', () => {
  const userData = dir();
  const created = createClient(userData, { nome: 'Codex', permissao: 'escrita' });
  assert.deepEqual(resolveAccess(userData, 'sph_chave-que-nao-existe', {}), {
    ok: false,
    erro: 'chave_invalida',
  });
  assert.deepEqual(resolveAccess(userData, undefined, { escrita: true }), {
    ok: false,
    erro: 'chave_invalida',
  });
  const legado = legacyState(userData);
  assert.equal(legado.ativo, false);
  assert.match(legado.aviso, /configuração atual/);
  assert.match(legado.aviso, /chave_invalida/);
  const ligado = setLegacy(userData, { ativo: true });
  assert.equal(ligado.ativo, true);
  assert.match(ligado.aviso, /sem chave/);
  const aberto = resolveAccess(userData, undefined, { escrita: true });
  assert.equal(aberto.ok && aberto.permissao, 'escrita');
  assert.equal(aberto.ok && aberto.autor, 'mcp:legado');
  const rebaixado = resolveAccess(userData, created.chave, { somenteLeitura: true });
  assert.equal(rebaixado.ok && rebaixado.permissao, 'leitura');
  const desligado = setLegacy(userData, { ativo: false });
  assert.equal(desligado.ativo, false);
  assert.match(desligado.aviso, /README/);
});

test('o trecho do Codex e o do Claude não usam a mesma chave nem o mesmo nome', () => {
  const codex = mcpConfigSnippet({ nome: 'Codex', biblioteca: '/biblio' }, 'sph_codex', 'stdio');
  const claude = mcpConfigSnippet({ nome: 'Claude', biblioteca: '/biblio' }, 'sph_claude', 'stdio');
  assert.equal(serverKey('Codex'), 'sophy-codex');
  assert.equal(serverKey('Claude'), 'sophy-claude');
  assert.match(codex.codex, /\[mcp_servers\.sophy-codex\]/);
  assert.match(codex.codex, /SOPHY_MCP_KEY = "sph_codex"/);
  assert.equal(codex.codex.includes('sph_claude'), false);
  assert.match(codex.claude, /"mcpServers"/);
  assert.match(codex.claude, /sph_codex/);
  assert.equal(codex.claude.includes('sph_claude'), false);
  assert.match(claude.claude, /sophy-claude/);
  assert.equal(claude.claude.includes('sph_codex'), false);
  const http = mcpConfigSnippet({ nome: 'Codex' }, 'sph_codex', 'http');
  assert.match(http.codex, /Authorization = "Bearer sph_codex"/);
  assert.match(http.claude, /"type": "http"/);
  assert.match(http.claude, /Bearer sph_codex/);
  const userData = dir();
  const created = createClient(userData, { nome: 'Codex', permissao: 'escrita' });
  const snippet = mcpAdmin(
    'mcp.clients.snippet',
    { nome: 'Codex', chave: created.chave },
    userData,
    { biblioteca: '/notas', comando: 'node', args: ['cli', 'mcp', '--biblioteca', '/notas'] },
  ) as { stdio: { codex: string; claude: string }; http: { claude: string } };
  assert.match(snippet.stdio.codex, new RegExp(created.chave));
  assert.match(snippet.stdio.claude, /mcpServers/);
  assert.match(snippet.http.claude, /Bearer/);
  assert.throws(
    () => mcpAdmin('mcp.clients.snippet', { nome: 'Codex', chave: 'sph_outra' }, userData),
    (error: unknown) => error instanceof EngineError && error.code === 'chave_invalida',
  );
});

test('clientes e legado não entram no registro, na Sofi nem no callTool', () => {
  for (const name of MCP_ADMIN_TOOLS) {
    assert.equal(
      tools.some((tool) => tool.name === name),
      false,
      name,
    );
    assert.equal(
      sofiTools('agente').some((tool) => tool.function.name === name),
      false,
      name,
    );
    assert.equal(
      sofiTools('pergunta').some((tool) => tool.function.name === name),
      false,
      name,
    );
    assert.throws(
      () => callTool(name, {}),
      (error: unknown) => error instanceof EngineError && error.code === 'not-found',
    );
  }
  assert.equal(toolsForPermission('leitura').some((tool) => tool.name === 'note.write'), false);
  assert.equal(toolsForPermission('leitura').some((tool) => tool.name === 'activity.list'), true);
  assert.equal(toolsForPermission('leitura').some((tool) => tool.name === 'activity.diff'), true);
  assert.equal(toolsForPermission('leitura').some((tool) => tool.name === 'activity.undo'), false);
  assert.equal(toolsForPermission('escrita').some((tool) => tool.name === 'note.write'), true);
  assert.equal(toolsForPermission('escrita').some((tool) => tool.name === 'activity.undo'), true);
  for (const name of ['trash.purge', 'trash.empty', 'note.deletePermanent', 'vault.import', 'site.export', 'library.switch']) {
    assert.equal(toolsForPermission('escrita').some((tool) => tool.name === name), false, name);
    assert.equal(isReadOnlyTool(name), false, name);
  }
  assert.equal(isReadOnlyTool('note.read'), true);
  assert.equal(toolMutates('note.write'), true);
  assert.equal(userDataDir({ SOPHY_USER_DATA: '/tmp/sophy-user', PATH: '' } as NodeJS.ProcessEnv), '/tmp/sophy-user');
});
