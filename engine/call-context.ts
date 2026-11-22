import { AsyncLocalStorage } from 'node:async_hooks';

/** Quem disparou a chamada. O nome do cliente MCP entra no autor, nunca numa variável global. */
export type Author = 'usuario' | 'sofi' | `mcp:${string}`;

const storage = new AsyncLocalStorage<{ author: Author }>();

/** Corre `run` com o autor desta chamada. Chamadas paralelas não se misturam. */
export function withAuthor<T>(author: Author, run: () => T): T {
  return storage.run({ author }, run);
}

/** Autor da chamada atual. Fora de `withAuthor`, a pessoa na janela ou na CLI. */
export function currentAuthor(): Author {
  return storage.getStore()?.author ?? 'usuario';
}
