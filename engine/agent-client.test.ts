import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createProviderClient, listarModelos, testarConexao, type FetchLike } from './agent-client.ts';
import { runAgentTurn, type AgentProgress } from './agent.ts';
import { openLibrary } from './library.ts';

function captura(responder: (url: string, body: Record<string, unknown>) => unknown) {
  const vistos: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> =
    [];
  const fetchImpl: FetchLike = async (url, init) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    vistos.push({ url, body, headers: init.headers });
    return { ok: true, status: 200, json: async () => responder(url, body) };
  };
  return { fetchImpl, vistos };
}

function resposta(provider: string) {
  if (provider === 'anthropic') return { content: [{ type: 'text', text: 'ok' }] };
  if (provider === 'gemini-nativo') {
    return { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
  }
  return { choices: [{ message: { content: 'ok' } }] };
}

async function pedido(
  provider: string,
  model: string,
  endpoint: string,
  raciocinio: { ativo: boolean; esforco?: 'baixo' | 'medio' | 'alto'; orcamentoTokens?: number },
  kind = provider,
) {
  const visto = captura(() => resposta(kind));
  const client = createProviderClient({
    provider,
    endpoint,
    model,
    key: 'sk-teste',
    fetchImpl: visto.fetchImpl,
    raciocinio,
  });
  await client({
    messages: [{ role: 'user', content: 'oi' }],
    tools: [
      {
        type: 'function',
        function: { name: 'note.read', description: 'Lê', parameters: { type: 'object' } },
      },
    ],
  });
  return visto.vistos[0];
}

test('cada provedor traduz o raciocínio no corpo do pedido', async () => {
  const openai = await pedido('openai', 'gpt-5', 'https://api.openai.com/v1', {
    ativo: true,
    esforco: 'alto',
  });
  assert.equal(openai.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openai.body.reasoning_effort, 'high');
  assert.equal(openai.headers.Authorization, 'Bearer sk-teste');

  const anthropic = await pedido('anthropic', 'claude-sonnet-4-5', 'https://api.anthropic.com/v1', {
    ativo: true,
    esforco: 'baixo',
  });
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropic.headers['x-api-key'], 'sk-teste');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(anthropic.body.thinking, { type: 'enabled', budget_tokens: 1024 });
  assert.equal(Number(anthropic.body.max_tokens) > 1024, true);
  assert.equal('temperature' in anthropic.body, false);
  const tools = anthropic.body.tools as Array<{ name: string; input_schema: unknown }>;
  assert.equal(tools[0]?.name, 'note.read');
  assert.equal(tools[0]?.input_schema !== undefined, true);

  const comOrcamento = await pedido(
    'anthropic',
    'claude-sonnet-4-5',
    'https://api.anthropic.com/v1',
    { ativo: true, orcamentoTokens: 3000 },
  );
  assert.deepEqual(comOrcamento.body.thinking, { type: 'enabled', budget_tokens: 3000 });
  assert.equal(comOrcamento.body.max_tokens, 4024);

  const gemini = await pedido(
    'gemini',
    'gemini-2.5-flash',
    'https://generativelanguage.googleapis.com/v1beta/openai',
    { ativo: true, esforco: 'medio' },
  );
  assert.equal(gemini.body.reasoning_effort, 'medium');
  assert.match(gemini.url, /\/chat\/completions$/);

  const nativo = await pedido(
    'gemini',
    'gemini-2.5-pro',
    'https://generativelanguage.googleapis.com/v1beta',
    { ativo: true, orcamentoTokens: 2048 },
    'gemini-nativo',
  );
  assert.match(nativo.url, /:generateContent$/);
  assert.equal(nativo.headers['x-goog-api-key'], 'sk-teste');
  const config = nativo.body.generationConfig as {
    thinkingConfig: { thinkingBudget: number; includeThoughts: boolean };
  };
  assert.equal(config.thinkingConfig.thinkingBudget, 2048);
  assert.equal(config.thinkingConfig.includeThoughts, true);

  const router = await pedido(
    'openrouter',
    'anthropic/claude-sonnet-4-5',
    'https://openrouter.ai/api/v1',
    { ativo: true, orcamentoTokens: 1500 },
  );
  assert.deepEqual(router.body.reasoning, { max_tokens: 1500 });
  const routerEsforco = await pedido('openrouter', 'openai/gpt-5', 'https://openrouter.ai/api/v1', {
    ativo: true,
    esforco: 'baixo',
  });
  assert.deepEqual(routerEsforco.body.reasoning, { effort: 'low' });

  const groq = await pedido('groq', 'openai/gpt-oss-20b', 'https://api.groq.com/openai/v1', {
    ativo: true,
    esforco: 'medio',
  });
  assert.equal(groq.body.reasoning_effort, 'medium');
  const groqSem = await pedido('groq', 'llama-3.3-70b-versatile', 'https://api.groq.com/openai/v1', {
    ativo: true,
    esforco: 'alto',
  });
  assert.equal('reasoning_effort' in groqSem.body, false);

  const xai = await pedido('xai', 'grok-4', 'https://api.x.ai/v1', { ativo: true, esforco: 'alto' });
  assert.equal(xai.body.reasoning_effort, 'high');
  const xaiNao = await pedido('xai', 'grok-3', 'https://api.x.ai/v1', { ativo: true, esforco: 'alto' });
  assert.equal('reasoning_effort' in xaiNao.body, false);

  const ollama = await pedido('ollama', 'qwen3', 'http://localhost:11434/v1', {
    ativo: true,
    esforco: 'baixo',
  });
  assert.equal(ollama.body.think, 'low');
  assert.equal(ollama.headers.Authorization, 'Bearer sk-teste');

  const nvidia = await pedido(
    'nvidia',
    'deepseek-r1',
    'https://integrate.api.nvidia.com/v1',
    { ativo: true, esforco: 'alto' },
  );
  assert.equal('reasoning_effort' in nvidia.body, false);
  assert.equal('reasoning' in nvidia.body, false);
  assert.equal('think' in nvidia.body, false);

  const personalizado = await pedido('personalizado', 'gpt-5', 'http://localhost:8080/v1', {
    ativo: true,
    esforco: 'alto',
  });
  assert.equal(personalizado.url, 'http://localhost:8080/v1/chat/completions');
  assert.equal('reasoning_effort' in personalizado.body, false);
});

test('o loop da Anthropic reenvia o bloco thinking com signature', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-anthropic-'));
  openLibrary(root);
  const vistos: Array<Record<string, unknown>> = [];
  const progress: AgentProgress[] = [];
  const turn = await runAgentTurn({
    libraryPath: root,
    message: 'crie',
    key: 'sk-anthropic',
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
    raciocinio: { ativo: true, esforco: 'medio' },
    onProgress: (event) => progress.push(event),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body || '{}') as Record<string, unknown>;
      vistos.push(body);
      if (vistos.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [
              { type: 'thinking', thinking: 'vou criar a nota', signature: 'sig-abc' },
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'note.create',
                input: { path: 'Entrada/Ideia.md', body: 'oi\n' },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            { type: 'thinking', thinking: 'pronto', signature: 'sig-fim' },
            { type: 'text', text: 'Criei a nota.' },
          ],
        }),
      };
    },
  });
  const segundo = vistos[1];
  const mensagens = JSON.stringify(segundo.messages);
  assert.match(mensagens, /sig-abc/);
  assert.match(mensagens, /vou criar a nota/);
  assert.equal(turn.text, 'Criei a nota.');
  assert.equal(turn.text.includes('vou criar'), false);
  assert.match(turn.raciocinio || '', /vou criar a nota/);
  assert.equal(JSON.stringify(turn.actions).includes('vou criar'), false);
  assert.equal(fs.existsSync(path.join(root, 'Entrada', 'Ideia.md')), true);
  const raciocinio = progress.filter((event) => event.phase === 'reasoning');
  assert.equal(raciocinio.length >= 1, true);
  assert.equal(raciocinio[0]?.resumo, 'vou criar a nota');
  assert.equal(progress.some((event) => event.phase === 'thinking'), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('teste de conexão classifica o erro e models cai para os sugeridos', async () => {
  const semChave = await testarConexao({
    provider: 'openai',
    model: 'gpt-4o-mini',
    fetchImpl: async () => {
      throw new Error('não devia chamar');
    },
  });
  assert.equal(semChave.ok, false);
  assert.equal(semChave.error, 'sem_chave');
  assert.equal(typeof semChave.latencyMs, 'number');
  assert.equal(semChave.model, 'gpt-4o-mini');

  const rede = await testarConexao({
    provider: 'ollama',
    model: 'llama3.2',
    endpoint: 'http://localhost:11434/v1',
    fetchImpl: async () => {
      throw new Error('recusou conexão');
    },
  });
  assert.equal(rede.error, 'endpoint_inalcancavel');

  const chave = await testarConexao({
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-ruim',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid api key sk-ruim' } }),
    }),
  });
  assert.equal(chave.error, 'chave_invalida');
  assert.equal(chave.mensagem?.includes('sk-ruim'), false);

  const modelo = await testarConexao({
    provider: 'openai',
    model: 'nao-existe',
    apiKey: 'sk-ok',
    raciocinio: { ativo: true, esforco: 'alto' },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body || '{}') as Record<string, unknown>;
      assert.equal('reasoning_effort' in body, false);
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'model not found' } }),
      };
    },
  });
  assert.equal(modelo.error, 'modelo_inexistente');

  const ok = await testarConexao({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    apiKey: 'sk-ok',
    raciocinio: { ativo: true, esforco: 'alto' },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body || '{}') as { thinking?: { budget_tokens: number } };
      assert.equal(body.thinking?.budget_tokens, 16384);
      return { ok: true, status: 200, json: async () => ({ content: [] }) };
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.error, undefined);

  const daApi = await listarModelos({
    provider: 'openai',
    apiKey: 'sk-ok',
    fetchImpl: async (url) => {
      assert.match(url, /\/models$/);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o-mini' }] }),
      };
    },
  });
  assert.equal(daApi.fonte, 'api');
  assert.equal(daApi.models.find((item) => item.id === 'gpt-5')?.raciocinio, true);
  assert.equal(daApi.models.find((item) => item.id === 'gpt-4o-mini')?.raciocinio, false);
  assert.deepEqual(daApi.models.find((item) => item.id === 'gpt-5')?.esforcos, [
    'baixo',
    'medio',
    'alto',
  ]);

  const ollama = await listarModelos({
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1',
    fetchImpl: async (url) => {
      assert.equal(url, 'http://localhost:11434/api/tags');
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen3:latest' }] }),
      };
    },
  });
  assert.equal(ollama.fonte, 'api');
  assert.equal(ollama.models[0]?.id, 'qwen3:latest');
  assert.equal(ollama.models[0]?.raciocinio, true);

  const queda = await listarModelos({
    provider: 'groq',
    apiKey: 'sk-ok',
    fetchImpl: async () => {
      throw new Error('rede');
    },
  });
  assert.equal(queda.fonte, 'sugeridos');
  assert.equal(queda.models.some((item) => item.id.includes('gpt-oss')), true);
  assert.equal(queda.models.some((item) => item.raciocinio), true);
});
