import { toolMutates, tools, type Tool } from './tools.ts';

/**
 * Ferramentas que ficam só no aplicativo.
 * `library.switch` não está no registro: a troca de biblioteca é o IPC `sophy:switch-library`.
 * O nome entra aqui para o MCP recusar a chamada com `permissao_negada` sem executar nada.
 */
export const APP_ONLY_TOOLS = [
  'trash.purge',
  'trash.empty',
  'note.deletePermanent',
  'vault.import',
  'site.export',
  'library.switch',
] as const;

const appOnly = new Set<string>(APP_ONLY_TOOLS);

export type McpPermissao = 'leitura' | 'escrita';

export function isAppOnly(name: string) {
  return appOnly.has(name);
}

/**
 * Lista única das ferramentas somente leitura: o registro menos as mutantes e as destrutivas.
 * O modo Pergunta da Sofi (PR 8, ainda fora desta base) e o cliente MCP `leitura` usam esta função.
 */
export function isReadOnlyTool(name: string) {
  return !toolMutates(name) && !isAppOnly(name);
}

export function toolsForPermission(permissao: McpPermissao): Tool[] {
  if (permissao === 'leitura') return tools.filter((tool) => isReadOnlyTool(tool.name));
  return tools.filter((tool) => !isAppOnly(tool.name));
}

export function permissionAllows(permissao: McpPermissao, name: string) {
  if (isAppOnly(name)) return false;
  if (permissao === 'leitura') return isReadOnlyTool(name);
  return true;
}
