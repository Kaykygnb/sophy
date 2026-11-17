import { EngineError } from './errors.ts';
import { callTool, listTools } from './tools.ts';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

const blocked = /key|chave|secret|token|senha/i;

export function agentTools() {
  return listTools()
    .filter((tool) => !tool.name.startsWith('ui.') && !blocked.test(tool.name))
    .map((tool) => ({
      type: 'function' as const,
      function: { name: tool.name, description: tool.description },
    }));
}

export async function runAgentTurn(options: {
  libraryPath: string;
  message: string;
  key: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}) {
  const key = options.key.trim();
  if (!key) throw new EngineError('invalid-note', 'Guarde a chave no cofre do sistema.');
  const fetchImpl = options.fetchImpl;
  if (!fetchImpl) throw new EngineError('invalid-note', 'O pedido à Sofi sai só do processo principal.');
  const response = await fetchImpl(options.endpoint || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é a Sofi. Use as tools da biblioteca. Não revele a chave e não a grave numa nota.' },
        { role: 'user', content: options.message },
      ],
      tools: agentTools(),
    }),
  });
  if (!response.ok) throw new EngineError('invalid-note', 'O provedor recusou o pedido.');
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  };
  const message = payload.choices?.[0]?.message;
  const results = [];
  for (const call of (message?.tool_calls || []).slice(0, 4)) {
    const name = call.function?.name || '';
    if (!name || blocked.test(name) || name.startsWith('ui.')) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    delete args.key;
    delete args.apiKey;
    delete args.token;
    results.push({
      name,
      value: callTool(name, { ...args, libraryPath: options.libraryPath, origin: 'agent' }),
    });
  }
  const text = String(message?.content || (results.length ? 'Pronto.' : 'Sem resposta.')).replaceAll(key, '•••');
  return { text, results };
}
