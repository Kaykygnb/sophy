import { EngineError } from './errors.ts';
import { provedor, type AgentProvider } from './agent-providers.ts';
import {
  anunciarModelo,
  capacidadeDoModelo,
  endpointGeminiNativo,
  esforcoApi,
  orcamentoDe,
  type Raciocinio,
} from './agent-reasoning.ts';

export type FetchInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type FetchLike = (
  url: string,
  init: FetchInit,
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

export type ToolCallMessage = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type AgentModelMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCallMessage[];
      providerContent?: unknown;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type AgentToolSpec = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AgentModelReply = {
  content?: string | null;
  toolCalls?: Array<{ id?: string; name?: string; arguments?: unknown }>;
  reasoning?: string | null;
  providerContent?: unknown;
};

export type AgentModelClient = (input: {
  messages: AgentModelMessage[];
  tools: AgentToolSpec[];
  signal?: AbortSignal;
}) => Promise<AgentModelReply>;

export type ErroConexao =
  | 'sem_chave'
  | 'chave_invalida'
  | 'endpoint_inalcancavel'
  | 'modelo_inexistente'
  | 'erro_desconhecido';

export type ResultadoConexao = {
  ok: boolean;
  error?: ErroConexao;
  mensagem?: string;
  latencyMs: number;
  model: string;
};

const ANTHROPIC_VERSION = '2023-06-01';

function baseUrl(endpoint: string) {
  return endpoint.replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/messages$/, '');
}

function exigirProvedor(id: string): AgentProvider {
  const item = provedor(id);
  if (!item) throw new EngineError('invalid-path', 'Provedor desconhecido.');
  return item;
}

function cabecalhos(provider: AgentProvider, key: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.protocolo === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    return headers;
  }
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export function camposDeRaciocinio(input: {
  provider: string;
  endpoint: string;
  model: string;
  raciocinio?: Raciocinio | null;
}) {
  const raciocinio = input.raciocinio || undefined;
  if (!raciocinio?.ativo) return {};
  const capacidade = capacidadeDoModelo(input.provider, input.model);
  if (!capacidade.raciocinio) return {};
  if (input.provider === 'openai' || input.provider === 'groq' || input.provider === 'xai') {
    if (!capacidade.esforcos) return {};
    return { reasoning_effort: esforcoApi(raciocinio.esforco) };
  }
  if (input.provider === 'openrouter') {
    if (raciocinio.orcamentoTokens && capacidade.pensamentoOrcamento)
      return { reasoning: { max_tokens: raciocinio.orcamentoTokens } };
    if (capacidade.esforcos) return { reasoning: { effort: esforcoApi(raciocinio.esforco) } };
    return { reasoning: { enabled: true } };
  }
  if (input.provider === 'gemini') {
    if (endpointGeminiNativo(input.endpoint)) {
      return {
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: orcamentoDe(raciocinio),
            includeThoughts: true,
          },
        },
      };
    }
    if (!capacidade.esforcos) return {};
    return { reasoning_effort: esforcoApi(raciocinio.esforco) };
  }
  if (input.provider === 'ollama') {
    if (raciocinio.esforco && capacidade.esforcos) return { think: esforcoApi(raciocinio.esforco) };
    return { think: true };
  }
  return {};
}

function textoAnthropic(blocks: unknown) {
  if (!Array.isArray(blocks)) return { content: null, reasoning: null, tools: [] as AgentModelReply['toolCalls'] };
  const texts: string[] = [];
  const thoughts: string[] = [];
  const tools: NonNullable<AgentModelReply['toolCalls']> = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const item = block as Record<string, unknown>;
    if (item.type === 'thinking' && typeof item.thinking === 'string') thoughts.push(item.thinking);
    if (item.type === 'text' && typeof item.text === 'string' && item.text) texts.push(item.text);
    if (item.type === 'tool_use') {
      tools.push({
        id: typeof item.id === 'string' ? item.id : undefined,
        name: typeof item.name === 'string' ? item.name : '',
        arguments: item.input,
      });
    }
  }
  return {
    content: texts.length ? texts.join('\n') : null,
    reasoning: thoughts.length ? thoughts.join('\n') : null,
    tools,
  };
}

function mensagensAnthropic(messages: AgentModelMessage[]) {
  const system = messages
    .filter((item) => item.role === 'system')
    .map((item) => item.content)
    .join('\n\n');
  const converted: Array<Record<string, unknown>> = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      converted.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      if (Array.isArray(message.providerContent)) {
        converted.push({ role: 'assistant', content: message.providerContent });
        continue;
      }
      const content: unknown[] = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.tool_calls || []) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.function.arguments || '{}');
        } catch {
          input = {};
        }
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
      }
      converted.push({ role: 'assistant', content: content.length ? content : '' });
      continue;
    }
    const results: unknown[] = [];
    while (index < messages.length && messages[index].role === 'tool') {
      const tool = messages[index];
      if (tool.role === 'tool') {
        results.push({
          type: 'tool_result',
          tool_use_id: tool.tool_call_id,
          content: tool.content,
        });
      }
      index += 1;
    }
    index -= 1;
    converted.push({ role: 'user', content: results });
  }
  return { system, messages: converted };
}

function corpoAnthropic(input: {
  model: string;
  messages: AgentModelMessage[];
  tools?: AgentToolSpec[];
  raciocinio?: Raciocinio | null;
  provider: string;
  ping?: boolean;
}) {
  const converted = mensagensAnthropic(input.messages);
  const capacidade = capacidadeDoModelo(input.provider, input.model);
  const pensar =
    input.raciocinio?.ativo && capacidade.raciocinio ? orcamentoDe(input.raciocinio) : undefined;
  const maxTokens = pensar ? pensar + 1024 : input.ping ? 16 : 4096;
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: maxTokens,
    messages: converted.messages,
  };
  if (converted.system) body.system = converted.system;
  if (pensar) body.thinking = { type: 'enabled', budget_tokens: pensar };
  if (!input.ping && input.tools?.length) {
    body.tools = input.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }
  return body;
}

function mensagensOpenAI(messages: AgentModelMessage[]) {
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const assistant: Record<string, unknown> = {
      role: 'assistant',
      content: message.content,
    };
    if (message.tool_calls?.length) assistant.tool_calls = message.tool_calls;
    return assistant;
  });
}

function textoRaciocinio(message: Record<string, unknown>) {
  if (typeof message.reasoning_content === 'string') return message.reasoning_content;
  if (typeof message.reasoning === 'string') return message.reasoning;
  return null;
}

async function pedir(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
) {
  return fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
}

function clienteAnthropic(options: {
  endpoint: string;
  model: string;
  key: string;
  fetchImpl: FetchLike;
  raciocinio?: Raciocinio | null;
}): AgentModelClient {
  const provider = exigirProvedor('anthropic');
  return async ({ messages, tools, signal }) => {
    const response = await pedir(
      options.fetchImpl,
      `${baseUrl(options.endpoint)}/messages`,
      cabecalhos(provider, options.key),
      corpoAnthropic({
        model: options.model,
        messages,
        tools,
        raciocinio: options.raciocinio,
        provider: 'anthropic',
      }),
      signal,
    );
    if (!response.ok) throw new EngineError('invalid-note', 'O provedor recusou o pedido.');
    const payload = (await response.json()) as { content?: unknown };
    const parsed = textoAnthropic(payload.content);
    return {
      content: parsed.content,
      toolCalls: parsed.tools,
      reasoning: parsed.reasoning,
      providerContent: Array.isArray(payload.content) ? payload.content : undefined,
    };
  };
}

function partesGemini(messages: AgentModelMessage[]) {
  const contents: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] });
      continue;
    }
    if (message.role === 'assistant') {
      const parts: unknown[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.tool_calls || []) {
        let args: unknown = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: call.function.name, args } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    contents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: message.tool_call_id,
            response: { content: message.content },
          },
        },
      ],
    });
  }
  return contents;
}

function clienteGeminiNativo(options: {
  endpoint: string;
  model: string;
  key: string;
  fetchImpl: FetchLike;
  raciocinio?: Raciocinio | null;
}): AgentModelClient {
  return async ({ messages, tools, signal }) => {
    const extra = camposDeRaciocinio({
      provider: 'gemini',
      endpoint: options.endpoint,
      model: options.model,
      raciocinio: options.raciocinio,
    });
    const system = messages
      .filter((item) => item.role === 'system')
      .map((item) => item.content)
      .join('\n\n');
    const body: Record<string, unknown> = {
      contents: partesGemini(messages),
      ...extra,
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (tools.length) {
      body.tools = [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          })),
        },
      ];
    }
    const url = `${baseUrl(options.endpoint)}/models/${encodeURIComponent(options.model)}:generateContent`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.key) headers['x-goog-api-key'] = options.key;
    const response = await pedir(options.fetchImpl, url, headers, body, signal);
    if (!response.ok) throw new EngineError('invalid-note', 'O provedor recusou o pedido.');
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
    };
    const parts = payload.candidates?.[0]?.content?.parts || [];
    const texts: string[] = [];
    const thoughts: string[] = [];
    const toolCalls: NonNullable<AgentModelReply['toolCalls']> = [];
    for (const part of parts) {
      if (part.thought === true && typeof part.text === 'string') thoughts.push(part.text);
      else if (typeof part.text === 'string' && part.text) texts.push(part.text);
      const call = part.functionCall as { name?: string; args?: unknown } | undefined;
      if (call && typeof call.name === 'string') {
        toolCalls.push({ name: call.name, arguments: call.args });
      }
    }
    return {
      content: texts.length ? texts.join('\n') : null,
      toolCalls,
      reasoning: thoughts.length ? thoughts.join('\n') : null,
    };
  };
}

function clienteCompativel(options: {
  provider: AgentProvider;
  endpoint: string;
  model: string;
  key: string;
  fetchImpl: FetchLike;
  raciocinio?: Raciocinio | null;
}): AgentModelClient {
  return async ({ messages, tools, signal }) => {
    const extra = camposDeRaciocinio({
      provider: options.provider.id,
      endpoint: options.endpoint,
      model: options.model,
      raciocinio: options.raciocinio,
    });
    const body: Record<string, unknown> = {
      model: options.model,
      messages: mensagensOpenAI(messages),
      tools,
      ...extra,
    };
    const response = await pedir(
      options.fetchImpl,
      `${baseUrl(options.endpoint)}/chat/completions`,
      cabecalhos(options.provider, options.key),
      body,
      signal,
    );
    if (!response.ok) throw new EngineError('invalid-note', 'O provedor recusou o pedido.');
    const payload = (await response.json()) as {
      choices?: Array<{ message?: Record<string, unknown> }>;
    };
    const message = payload.choices?.[0]?.message || {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    return {
      content: typeof message.content === 'string' ? message.content : null,
      reasoning: textoRaciocinio(message),
      toolCalls: calls.map((call) => {
        const item = call as { id?: string; function?: { name?: string; arguments?: unknown } };
        return {
          id: item.id,
          name: item.function?.name,
          arguments: item.function?.arguments,
        };
      }),
    };
  };
}

export function createProviderClient(options: {
  provider: string;
  endpoint?: string;
  model?: string;
  key: string;
  fetchImpl: FetchLike;
  raciocinio?: Raciocinio | null;
}): AgentModelClient {
  const provider = exigirProvedor(options.provider || 'openai');
  const endpoint = baseUrl(options.endpoint || provider.endpointPadrao);
  const model = options.model || 'gpt-4o-mini';
  if (provider.protocolo === 'anthropic') {
    return clienteAnthropic({
      endpoint,
      model,
      key: options.key,
      fetchImpl: options.fetchImpl,
      raciocinio: options.raciocinio,
    });
  }
  if (provider.id === 'gemini' && endpointGeminiNativo(endpoint)) {
    return clienteGeminiNativo({
      endpoint,
      model,
      key: options.key,
      fetchImpl: options.fetchImpl,
      raciocinio: options.raciocinio,
    });
  }
  return clienteCompativel({
    provider,
    endpoint,
    model,
    key: options.key,
    fetchImpl: options.fetchImpl,
    raciocinio: options.raciocinio,
  });
}

function mensagemCurta(texto: string, key: string) {
  const limpa = texto.replace(/\s+/g, ' ').trim();
  const semChave = key ? limpa.split(key).join('•••') : limpa;
  return (semChave || 'O provedor recusou o pedido.').slice(0, 180);
}

function textoErro(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const item = payload as Record<string, unknown>;
  if (typeof item.message === 'string') return item.message;
  if (typeof item.error === 'string') return item.error;
  if (item.error && typeof item.error === 'object') {
    const interno = item.error as Record<string, unknown>;
    if (typeof interno.message === 'string') return interno.message;
  }
  return '';
}

function classificar(status: number, texto: string): ErroConexao {
  if (status === 401 || status === 403) return 'chave_invalida';
  if (status === 404) return 'modelo_inexistente';
  if (
    (status === 400 || status === 422) &&
    /model|not found|does not exist|unknown|não encontr|inexistente/i.test(texto)
  ) {
    return 'modelo_inexistente';
  }
  return 'erro_desconhecido';
}

function frase(erro: ErroConexao, detalhe: string) {
  if (erro === 'sem_chave') return 'Guarde a chave antes de testar.';
  if (erro === 'chave_invalida') return 'A chave foi recusada.';
  if (erro === 'endpoint_inalcancavel') return 'Não foi possível alcançar o endpoint.';
  if (erro === 'modelo_inexistente') return detalhe || 'O modelo não existe nesse provedor.';
  return detalhe || 'O provedor recusou o pedido.';
}

async function ping(options: {
  provider: AgentProvider;
  endpoint: string;
  model: string;
  apiKey: string;
  raciocinio?: Raciocinio | null;
  fetchImpl: FetchLike;
}) {
  const messages: AgentModelMessage[] = [{ role: 'user', content: 'ping' }];
  if (options.provider.protocolo === 'anthropic') {
    return pedir(
      options.fetchImpl,
      `${baseUrl(options.endpoint)}/messages`,
      cabecalhos(options.provider, options.apiKey),
      corpoAnthropic({
        model: options.model,
        messages,
        raciocinio: options.raciocinio,
        provider: options.provider.id,
        ping: true,
      }),
    );
  }
  if (options.provider.id === 'gemini' && endpointGeminiNativo(options.endpoint)) {
    const extra = camposDeRaciocinio({
      provider: 'gemini',
      endpoint: options.endpoint,
      model: options.model,
      raciocinio: options.raciocinio,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.apiKey) headers['x-goog-api-key'] = options.apiKey;
    return pedir(
      options.fetchImpl,
      `${baseUrl(options.endpoint)}/models/${encodeURIComponent(options.model)}:generateContent`,
      headers,
      { contents: [{ role: 'user', parts: [{ text: 'ping' }] }], ...extra },
    );
  }
  const extra = camposDeRaciocinio({
    provider: options.provider.id,
    endpoint: options.endpoint,
    model: options.model,
    raciocinio: options.raciocinio,
  });
  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    ...extra,
  };
  if (options.provider.id === 'openai' && 'reasoning_effort' in extra) body.max_completion_tokens = 16;
  else body.max_tokens = 16;
  return pedir(
    options.fetchImpl,
    `${baseUrl(options.endpoint)}/chat/completions`,
    cabecalhos(options.provider, options.apiKey),
    body,
  );
}

export async function testarConexao(options: {
  provider: string;
  endpoint?: string;
  model: string;
  apiKey?: string;
  raciocinio?: Raciocinio | null;
  fetchImpl: FetchLike;
}): Promise<ResultadoConexao> {
  const started = Date.now();
  const model = options.model;
  const fechar = (parcial: Omit<ResultadoConexao, 'latencyMs' | 'model'>): ResultadoConexao => ({
    ...parcial,
    latencyMs: Date.now() - started,
    model,
  });
  const provider = provedor(options.provider);
  if (!provider) {
    return fechar({
      ok: false,
      error: 'erro_desconhecido',
      mensagem: 'Provedor desconhecido.',
    });
  }
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
  if (provider.precisaChave && !apiKey) {
    return fechar({ ok: false, error: 'sem_chave', mensagem: frase('sem_chave', '') });
  }
  const endpoint = options.endpoint || provider.endpointPadrao;
  if (!endpoint) {
    return fechar({ ok: false, error: 'endpoint_inalcancavel', mensagem: 'Informe o endpoint.' });
  }
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await ping({
      provider,
      endpoint,
      model,
      apiKey,
      raciocinio: options.raciocinio,
      fetchImpl: options.fetchImpl,
    });
  } catch {
    return fechar({
      ok: false,
      error: 'endpoint_inalcancavel',
      mensagem: frase('endpoint_inalcancavel', ''),
    });
  }
  if (response.ok) return fechar({ ok: true });
  let detalhe = '';
  try {
    detalhe = textoErro(await response.json());
  } catch {
    detalhe = '';
  }
  const error = classificar(response.status || 0, detalhe);
  return fechar({
    ok: false,
    error,
    mensagem: mensagemCurta(frase(error, detalhe), apiKey),
  });
}

function urlModelos(provider: string, endpoint: string) {
  const base = baseUrl(endpoint);
  if (provider === 'ollama') return `${base.replace(/\/v1$/, '')}/api/tags`;
  return `${base}/models`;
}

function extrairModelos(provider: string, payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as Record<string, unknown>;
  if (provider === 'ollama') {
    if (!Array.isArray(item.models)) return null;
    const models = item.models.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      const id = typeof row.name === 'string' ? row.name : typeof row.model === 'string' ? row.model : '';
      return id ? [{ id, nome: id }] : [];
    });
    return models;
  }
  if (!Array.isArray(item.data)) return null;
  return item.data.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id) return [];
    const nome =
      typeof row.display_name === 'string'
        ? row.display_name
        : typeof row.name === 'string'
          ? row.name
          : row.id;
    return [{ id: row.id, nome }];
  });
}

export async function listarModelos(options: {
  provider: string;
  endpoint?: string;
  apiKey?: string;
  fetchImpl: FetchLike;
}) {
  const provider = exigirProvedor(options.provider);
  const sugeridos = () => ({
    models: provider.modelosSugeridos.map((id) => anunciarModelo(provider.id, id)),
    fonte: 'sugeridos' as const,
  });
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
  if (provider.precisaChave && !apiKey) return sugeridos();
  const endpoint = options.endpoint || provider.endpointPadrao;
  if (!endpoint) return sugeridos();
  try {
    const headers = cabecalhos(provider, apiKey);
    if (provider.id === 'gemini' && endpointGeminiNativo(endpoint) && apiKey) {
      delete headers.Authorization;
      headers['x-goog-api-key'] = apiKey;
    }
    const response = await options.fetchImpl(urlModelos(provider.id, endpoint), {
      method: 'GET',
      headers,
    });
    if (!response.ok) return sugeridos();
    const found = extrairModelos(provider.id, await response.json());
    if (!found) return sugeridos();
    return {
      models: found.map((item) => anunciarModelo(provider.id, item.id, item.nome)),
      fonte: 'api' as const,
    };
  } catch {
    return sugeridos();
  }
}

export function corpoDeTeste(options: {
  provider: string;
  endpoint: string;
  model: string;
  raciocinio?: Raciocinio | null;
}) {
  const provider = exigirProvedor(options.provider);
  const messages: AgentModelMessage[] = [{ role: 'user', content: 'ping' }];
  if (provider.protocolo === 'anthropic') {
    return {
      url: `${baseUrl(options.endpoint)}/messages`,
      body: corpoAnthropic({
        model: options.model,
        messages,
        raciocinio: options.raciocinio,
        provider: provider.id,
        ping: true,
      }),
    };
  }
  if (provider.id === 'gemini' && endpointGeminiNativo(options.endpoint)) {
    return {
      url: `${baseUrl(options.endpoint)}/models/${encodeURIComponent(options.model)}:generateContent`,
      body: {
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        ...camposDeRaciocinio({
          provider: 'gemini',
          endpoint: options.endpoint,
          model: options.model,
          raciocinio: options.raciocinio,
        }),
      },
    };
  }
  const extra = camposDeRaciocinio({
    provider: provider.id,
    endpoint: options.endpoint,
    model: options.model,
    raciocinio: options.raciocinio,
  });
  const body: Record<string, unknown> = { model: options.model, messages, ...extra };
  if (provider.id === 'openai' && 'reasoning_effort' in extra) body.max_completion_tokens = 16;
  else body.max_tokens = 16;
  return { url: `${baseUrl(options.endpoint)}/chat/completions`, body };
}
