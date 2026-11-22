import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Permissao } from './mcp-clients.ts';

export function mcpEnv(userData: string, chave: string, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== 'SOPHY_LIBRARY') env[key] = value;
  }
  env.SOPHY_USER_DATA = userData;
  env.SOPHY_MCP_KEY = chave;
  return { ...env, ...extra };
}

export function issueKey(permissao: Permissao, nome = 'Teste') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-mcp-user-'));
  const created = createClient(userData, { nome, permissao });
  return { userData, chave: created.chave, id: created.id, nome: created.nome };
}

export const mcpBin = path.resolve('engine/cli.ts');
