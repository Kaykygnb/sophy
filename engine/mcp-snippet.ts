import path from 'node:path';
import { EngineError } from './errors.ts';

export type TransporteMcp = 'stdio' | 'http';

/** Dados públicos para montar o trecho. A função não lê disco nem ambiente. */
export type SnippetCliente = {
  nome: string;
  biblioteca?: string;
  comando?: string;
  args?: string[];
  url?: string;
  /** `true` quando `comando` é o binário do Electron (dev ou app empacotado). */
  electron?: boolean;
};

export type ConfigSnippet = {
  codex: string;
  claude: string;
  aviso?: string;
};

/**
 * Trechos prontos para colar no Codex (`config.toml`) e no Claude (`mcpServers`).
 * Cada cliente ganha uma chave de servidor própria, para os dois não parecerem o mesmo agente.
 */
export function mcpConfigSnippet(cliente: SnippetCliente, chave: string, transporte: TransporteMcp) {
  if (transporte !== 'stdio' && transporte !== 'http')
    throw new EngineError('transporte_invalido', 'O transporte é stdio ou http.');
  const nome = typeof cliente?.nome === 'string' ? cliente.nome.trim() : '';
  if (!nome) throw new EngineError('nome_invalido', 'Informe o nome do cliente.');
  if (typeof chave !== 'string' || !chave.startsWith('sph_'))
    throw new EngineError('chave_invalida', 'A chave do trecho é a que acabou de ser mostrada.');
  const id = serverKey(nome);
  if (transporte === 'stdio') return stdioSnippet(cliente, chave, nome, id);
  return httpSnippet(cliente, chave, nome, id);
}

function stdioSnippet(cliente: SnippetCliente, chave: string, nome: string, id: string): ConfigSnippet {
  const comando = cliente.comando || 'node';
  const args = completeStdioArgs(cliente);
  const env = stdioEnv(comando, chave, cliente.electron);
  const envLines = Object.entries(env).map(([key, value]) => `${key} = ${toml(value)}`);
  const codex = [
    `# Cliente ${nome}. A chave aparece só neste trecho; o Sophy guarda o hash.`,
    `[mcp_servers.${id}]`,
    `command = ${toml(comando)}`,
    `args = [${args.map(toml).join(', ')}]`,
    '',
    `[mcp_servers.${id}.env]`,
    ...envLines,
    '',
  ].join('\n');
  const claude = JSON.stringify({ mcpServers: { [id]: { command: comando, args, env } } }, null, 2);
  const insideAsar = args.some((arg) => arg.includes('.asar'));
  return insideAsar
    ? {
        codex,
        claude,
        aviso:
          'O caminho de engine/cli.ts está dentro de app.asar. ELECTRON_RUN_AS_NODE não lê o asar. No app empacotado use node com o cli.ts do repositório. Veja o README, seção MCP local.',
      }
    : { codex, claude };
}

/** `sophy mcp` é `node --experimental-strip-types engine/cli.ts mcp`. O binário do Electron só faz isso com ELECTRON_RUN_AS_NODE=1. */
function runsAsElectron(comando: string, electron: boolean | undefined) {
  if (electron === true) return true;
  if (electron === false) return false;
  const base = path.basename(comando).replace(/\.exe$/i, '').toLowerCase();
  if (base === 'node' || base === 'nodejs') return false;
  if (base === 'electron' || base === 'sophy') return true;
  return /[\\/]electron([\\/]|$)/i.test(comando);
}

function stdioEnv(comando: string, chave: string, electron: boolean | undefined) {
  const env: Record<string, string> = {};
  if (runsAsElectron(comando, electron)) env.ELECTRON_RUN_AS_NODE = '1';
  env.SOPHY_MCP_KEY = chave;
  return env;
}

function completeStdioArgs(cliente: SnippetCliente) {
  const given = cliente.args?.length ? [...cliente.args] : [];
  const cli =
    given.find((arg) => /(^|[\\/])cli\.(ts|js)$/.test(arg)) ??
    (given.some((arg) => arg === 'mcp') ? undefined : 'engine/cli.ts');
  const hasCli = given.some((arg) => /(^|[\\/])cli\.(ts|js)$/.test(arg));
  const hasMcp = given.includes('mcp');
  let args: string[];
  if (hasCli && hasMcp) args = [...given];
  else args = ['--experimental-strip-types', cli || 'engine/cli.ts', 'mcp'];
  if (!args.includes('--experimental-strip-types') && args.some((arg) => arg.endsWith('.ts')))
    args.unshift('--experimental-strip-types');
  const biblioteca = cliente.biblioteca;
  if (
    biblioteca &&
    !args.includes('--biblioteca') &&
    !args.some((arg) => arg.startsWith('--biblioteca='))
  )
    args.push('--biblioteca', biblioteca);
  return args;
}

function httpSnippet(cliente: SnippetCliente, chave: string, nome: string, id: string) {
  const url = cliente.url || 'http://127.0.0.1:8734/mcp';
  const header = `Bearer ${chave}`;
  const codex = [
    `# Cliente ${nome}. HTTP local com Bearer; a chave não fica gravada no Sophy.`,
    `[mcp_servers.${id}]`,
    `url = ${toml(url)}`,
    `http_headers = { Authorization = ${toml(header)} }`,
    '',
  ].join('\n');
  const claude = JSON.stringify(
    { mcpServers: { [id]: { type: 'http', url, headers: { Authorization: header } } } },
    null,
    2,
  );
  return { codex, claude };
}

export function serverKey(nome: string) {
  const slug = nome
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `sophy-${slug || 'cliente'}`;
}

function toml(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
