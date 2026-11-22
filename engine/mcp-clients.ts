import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { mcpConfigSnippet, type SnippetCliente, type TransporteMcp } from './mcp-snippet.ts';
import { dropClientSessions, dropLegacySessions, reconcileSessions } from './mcp-sessions.ts';

export type Permissao = 'leitura' | 'escrita';

export type ClientePublico = {
  id: string;
  nome: string;
  permissao: Permissao;
  ativo: boolean;
  final: string;
  criadoEm: string;
  ultimoUso: string | null;
};

export type ClienteCriado = {
  id: string;
  nome: string;
  permissao: Permissao;
  chave: string;
};

type StoredClient = {
  id: string;
  nome: string;
  permissao: Permissao;
  ativo: boolean;
  hash: string;
  final: string;
  criadoEm: string;
  ultimoUso: string | null;
};

export type LiveAccess =
  | {
      ok: true;
      permissao: Permissao;
      autor: `mcp:${string}`;
      clientId: string | null;
      nome: string;
    }
  | { ok: false; erro: 'chave_invalida' | 'cliente_desativado' };

export const MCP_ADMIN_TOOLS = [
  'mcp.clients.list',
  'mcp.clients.create',
  'mcp.clients.revoke',
  'mcp.clients.toggle',
  'mcp.clients.snippet',
  'mcp.legacy.get',
  'mcp.legacy.set',
] as const;

const NOME = /^[\p{L}\p{N}][\p{L}\p{N} ._'()-]{0,39}$/u;

const AVISO_DESLIGADO =
  'O modo legado está desligado. A configuração atual do Codex e do Claude, que sobe o MCP sem chave, deixa de conectar (chave_invalida). Crie um cliente e cole o trecho de mcp.clients.snippet. Ligue o legado só para manter esse acesso antigo. Veja o README, seção MCP local.';

const AVISO_LIGADO =
  'O modo legado está ligado. O MCP aceita conexão sem chave, como a configuração antiga. A permissão vem de --escrita (gravação) ou do padrão somente leitura. As ferramentas destrutivas continuam só no aplicativo.';

/** Mesma pasta que `app.getPath('userData')` com o nome Sophy. Fora da biblioteca, nunca sincronizada. */
export function userDataDir(env: NodeJS.ProcessEnv = process.env) {
  if (env.SOPHY_USER_DATA && env.SOPHY_USER_DATA.trim()) return path.resolve(env.SOPHY_USER_DATA);
  const home = os.homedir();
  if (process.platform === 'win32')
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Sophy');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Sophy');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Sophy');
}

export function createClient(userData: string, input: unknown): ClienteCriado {
  const body = record(input);
  const nome = validNome(body.nome);
  const permissao = validPermissao(body.permissao);
  const clients = readClients(userData);
  if (clients.some((client) => sameNome(client.nome, nome)))
    throw new EngineError('nome_em_uso', 'Já existe um cliente com esse nome.');
  const chave = `sph_${randomBytes(32).toString('base64url')}`;
  const stored: StoredClient = {
    id: randomUUID(),
    nome,
    permissao,
    ativo: true,
    hash: hashKey(chave),
    final: chave.slice(-4),
    criadoEm: new Date().toISOString(),
    ultimoUso: null,
  };
  clients.push(stored);
  writeClients(userData, clients);
  return { id: stored.id, nome, permissao, chave };
}

export function listClients(userData: string): ClientePublico[] {
  return readClients(userData)
    .map(publish)
    .sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : 0));
}

export function revokeClient(userData: string, input: unknown) {
  const id = validId(input);
  const clients = readClients(userData);
  const next = clients.filter((client) => client.id !== id);
  if (next.length === clients.length)
    throw new EngineError('cliente_inexistente', 'Não encontrei esse cliente.');
  writeClients(userData, next);
  dropClientSessions(id);
  return { id, removido: true as const };
}

export function toggleClient(userData: string, input: unknown): ClientePublico {
  const body = record(input);
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) throw new EngineError('cliente_inexistente', 'Não encontrei esse cliente.');
  if (typeof body.ativo !== 'boolean')
    throw new EngineError('ativo_invalido', 'ativo é true ou false.');
  const clients = readClients(userData);
  const client = clients.find((item) => item.id === id);
  if (!client) throw new EngineError('cliente_inexistente', 'Não encontrei esse cliente.');
  client.ativo = body.ativo;
  writeClients(userData, clients);
  if (!body.ativo) dropClientSessions(id);
  return publish(client);
}

export function legacyState(userData: string) {
  const ativo = readLegacy(userData);
  return { ativo, aviso: ativo ? AVISO_LIGADO : AVISO_DESLIGADO };
}

export function setLegacy(userData: string, input: unknown) {
  const body = record(input);
  if (typeof body.ativo !== 'boolean')
    throw new EngineError('ativo_invalido', 'ativo é true ou false.');
  writeJson(legacyFile(userData), { version: 1, ativo: body.ativo });
  if (!body.ativo) dropLegacySessions();
  return { ativo: body.ativo, aviso: body.ativo ? AVISO_LIGADO : AVISO_DESLIGADO };
}

export function clientSnippet(
  userData: string,
  input: unknown,
  hint: Partial<SnippetCliente> = {},
) {
  const body = record(input);
  const nome = validNome(body.nome);
  if (typeof body.chave !== 'string' || !body.chave.startsWith('sph_'))
    throw new EngineError('chave_invalida', 'Informe a chave que acabou de ser mostrada.');
  const client = readClients(userData).find((item) => sameNome(item.nome, nome));
  if (!client) throw new EngineError('cliente_inexistente', 'Não encontrei esse cliente.');
  if (!hashEquals(client.hash, hashKey(body.chave)))
    throw new EngineError('chave_invalida', 'A chave não é a deste cliente.');
  const cliente: SnippetCliente = {
    nome: client.nome,
    biblioteca: hint.biblioteca,
    comando: hint.comando,
    args: hint.args,
    url: hint.url,
  };
  return {
    stdio: mcpConfigSnippet(cliente, body.chave, 'stdio'),
    http: mcpConfigSnippet(cliente, body.chave, 'http'),
  };
}

export function resolveAccess(
  userData: string,
  key: string | undefined,
  flags: { somenteLeitura?: boolean; escrita?: boolean } = {},
): LiveAccess {
  const trimmed = key?.trim() ?? '';
  if (trimmed) {
    const found = matchKey(userData, trimmed);
    if (found === 'invalid') return { ok: false, erro: 'chave_invalida' };
    if (found === 'disabled') return { ok: false, erro: 'cliente_desativado' };
    const permissao: Permissao = flags.somenteLeitura ? 'leitura' : found.permissao;
    return {
      ok: true,
      permissao,
      autor: `mcp:${found.nome}`,
      clientId: found.id,
      nome: found.nome,
    };
  }
  if (!readLegacy(userData)) return { ok: false, erro: 'chave_invalida' };
  const permissao: Permissao = flags.escrita && !flags.somenteLeitura ? 'escrita' : 'leitura';
  return { ok: true, permissao, autor: 'mcp:legado', clientId: null, nome: 'legado' };
}

export function touchClient(userData: string, id: string) {
  const clients = readClients(userData);
  const client = clients.find((item) => item.id === id);
  if (!client || !client.ativo) return;
  client.ultimoUso = new Date().toISOString();
  writeClients(userData, clients);
}

export function watchClients(userData: string) {
  fs.mkdirSync(userData, { recursive: true });
  const check = () => {
    try {
      const alive = new Set(readClients(userData).filter((client) => client.ativo).map((client) => client.id));
      reconcileSessions(alive, readLegacy(userData));
    } catch {
      /* arquivo no meio da troca; a próxima chamada confere de novo */
    }
  };
  const watcher = fs.watch(userData, { persistent: false }, check);
  watcher.on('error', () => {});
  return () => watcher.close();
}

export type SnippetHint = Partial<SnippetCliente>;

export function mcpAdmin(tool: string, input: unknown, userData: string, hint: SnippetHint = {}) {
  switch (tool) {
    case 'mcp.clients.list':
      return listClients(userData);
    case 'mcp.clients.create':
      return createClient(userData, input);
    case 'mcp.clients.revoke':
      return revokeClient(userData, input);
    case 'mcp.clients.toggle':
      return toggleClient(userData, input);
    case 'mcp.clients.snippet':
      return clientSnippet(userData, input, hint);
    case 'mcp.legacy.get':
      return legacyState(userData);
    case 'mcp.legacy.set':
      return setLegacy(userData, input);
    default:
      throw new EngineError('not-found', `Tool desconhecida: ${tool}.`);
  }
}

export function hashKey(chave: string) {
  return createHash('sha256').update(chave).digest('hex');
}

function matchKey(userData: string, chave: string): StoredClient | 'invalid' | 'disabled' {
  const digest = createHash('sha256').update(chave).digest();
  const clients = readClients(userData);
  let found: StoredClient | null = null;
  for (const client of clients) {
    const stored = Buffer.from(client.hash, 'hex');
    const sameLength = stored.length === digest.length;
    const equal = timingSafeEqual(sameLength ? stored : digest, digest) && sameLength;
    if (equal) found = client;
  }
  if (!clients.length) timingSafeEqual(digest, digest);
  if (!found) return 'invalid';
  if (!found.ativo) return 'disabled';
  return found;
}

function hashEquals(storedHex: string, incomingHex: string) {
  const stored = Buffer.from(storedHex, 'hex');
  const incoming = Buffer.from(incomingHex, 'hex');
  if (stored.length !== incoming.length) return false;
  return timingSafeEqual(stored, incoming);
}

function publish(client: StoredClient): ClientePublico {
  return {
    id: client.id,
    nome: client.nome,
    permissao: client.permissao,
    ativo: client.ativo,
    final: `…${client.final}`,
    criadoEm: client.criadoEm,
    ultimoUso: client.ultimoUso,
  };
}

function validNome(value: unknown) {
  if (typeof value !== 'string' || !NOME.test(value.trim()))
    throw new EngineError('nome_invalido', 'O nome do cliente é inválido.');
  return value.trim();
}

function validPermissao(value: unknown): Permissao {
  if (value !== 'leitura' && value !== 'escrita')
    throw new EngineError('permissao_invalida', 'A permissão é leitura ou escrita.');
  return value;
}

function validId(input: unknown) {
  const body = record(input);
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) throw new EngineError('cliente_inexistente', 'Não encontrei esse cliente.');
  return id;
}

function sameNome(left: string, right: string) {
  return left.localeCompare(right, 'pt', { sensitivity: 'accent' }) === 0;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function readClients(userData: string): StoredClient[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(clientsFile(userData), 'utf8')) as { clients?: StoredClient[] };
    return Array.isArray(parsed.clients) ? parsed.clients : [];
  } catch {
    return [];
  }
}

function writeClients(userData: string, clients: StoredClient[]) {
  writeJson(clientsFile(userData), { version: 1, clients });
}

function readLegacy(userData: string) {
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyFile(userData), 'utf8')) as { ativo?: unknown };
    return parsed.ativo === true;
  } catch {
    return false;
  }
}

function clientsFile(userData: string) {
  return path.join(userData, 'mcp-clients.json');
}

function legacyFile(userData: string) {
  return path.join(userData, 'mcp-legacy.json');
}

function writeJson(file: string, value: unknown) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* o Windows nem sempre aplica o modo */
  }
}

export type { TransporteMcp };
