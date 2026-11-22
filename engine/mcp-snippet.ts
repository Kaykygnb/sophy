import { EngineError } from './errors.ts';

export type TransporteMcp = 'stdio' | 'http';

/** Dados públicos para montar o trecho. A função não lê disco nem ambiente. */
export type SnippetCliente = {
  nome: string;
  biblioteca?: string;
  comando?: string;
  args?: string[];
  url?: string;
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

function stdioSnippet(cliente: SnippetCliente, chave: string, nome: string, id: string) {
  const comando = cliente.comando || 'node';
  const args = cliente.args?.length
    ? cliente.args
    : [
        '--experimental-strip-types',
        'engine/cli.ts',
        'mcp',
        '--biblioteca',
        cliente.biblioteca || '<biblioteca>',
      ];
  const codex = [
    `# Cliente ${nome}. A chave aparece só neste trecho; o Sophy guarda o hash.`,
    `[mcp_servers.${id}]`,
    `command = ${toml(comando)}`,
    `args = [${args.map(toml).join(', ')}]`,
    '',
    `[mcp_servers.${id}.env]`,
    `SOPHY_MCP_KEY = ${toml(chave)}`,
    '',
  ].join('\n');
  const claude = JSON.stringify(
    { mcpServers: { [id]: { command: comando, args, env: { SOPHY_MCP_KEY: chave } } } },
    null,
    2,
  );
  return { codex, claude };
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
